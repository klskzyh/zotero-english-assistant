/* 取正文。
 *
 * 两条路径：
 *   1. 读 Zotero 已经建好的全文缓存 .zotero-ft-cache，快，且对整本书来说省掉一次提取；
 *   2. 用 PDFWorker 现场提取文字层，慢一些，但缓存不存在或明显被截断时只能走这条。
 *
 * 这一层碰 Zotero 接口，离线测不了，所以判定逻辑写得很直白，出错时给出能看懂的原因。
 */

var WordFreq = WordFreq || {};

WordFreq.source = (function () {
	function isPdfAttachment(item) {
		if (!item || !item.isAttachment || !item.isAttachment()) {
			return false;
		}
		// Zotero 自己有 isPDFAttachment()，优先用它
		if (typeof item.isPDFAttachment === 'function') {
			return item.isPDFAttachment();
		}
		if (item.attachmentContentType === 'application/pdf') {
			return true;
		}
		// 老版本才需要退回看扩展名
		var path = item.attachmentPath || '';
		return /\.pdf$/i.test(String(path));
	}

	/** EPUB 附件：词频统计同样支持，取文本走 Zotero 的全文缓存 */
	function isEpubAttachment(item) {
		if (!item || !item.isAttachment || !item.isAttachment()) {
			return false;
		}
		if (item.attachmentContentType === 'application/epub+zip') {
			return true;
		}
		return /\.epub$/i.test(String(item.attachmentPath || ''));
	}

	/** 词频统计认的附件类型 */
	function isTextAttachment(item) {
		return isPdfAttachment(item) || isEpubAttachment(item);
	}

	/**
	 * 从条目上找到要统计的附件（PDF 或 EPUB）。
	 * 选中的本身就是附件时直接用它；是普通条目就找它挂的第一个。
	 *
	 * @returns {{attachment: object|null, reason: string}}
	 */
	function findTextSource(item) {
		if (!item) {
			return { attachment: null, reason: '没有选中任何条目。' };
		}
		if (isTextAttachment(item)) {
			return { attachment: item, reason: '' };
		}
		if (item.isAttachment && item.isAttachment()) {
			return { attachment: null, reason: '这个附件不是 PDF 或 EPUB，无法统计词频。' };
		}
		var ids = item.getAttachments ? item.getAttachments() : [];
		var fallback = null;
		for (var i = 0; i < ids.length; i++) {
			var att = Zotero.Items.get(ids[i]);
			if (!att) {
				continue;
			}
			if (isTextAttachment(att)) {
				// 优先挑第一个；分部统计会再筛一次只留 PDF
				if (!fallback) {
					fallback = att;
				}
			}
		}
		if (fallback) {
			return { attachment: fallback, reason: '' };
		}
		return { attachment: null, reason: '这个条目下没有 PDF 或 EPUB 附件。' };
	}

	/**
	 * 只给「需要页码」的旧调用方用：EPUB 没有页码，直接返回原因。
	 * 分部词频从 1.14.0 起改用 findTextSource + attachmentKind，不再走这里。
	 */
	function findPdf(item) {
		var found = findTextSource(item);
		if (found.attachment && isEpubAttachment(found.attachment)) {
			return {
				attachment: null,
				reason: '分部统计只支持 PDF；这篇是 EPUB，请用「整本词频」统计。',
			};
		}
		return found;
	}


	/** 附件在磁盘上的绝对路径 */
	async function pathOf(attachment) {
		if (attachment.getFilePathAsync) {
			var p = await attachment.getFilePathAsync();
			if (p) {
				return p;
			}
		}
		if (attachment.attachmentPath) {
			return attachment.attachmentPath;
		}
		return null;
	}

	/** 已索引页数 / 总页数，用来判断缓存是不是被截断了 */
	async function pagesOf(attachment) {
		try {
			var info = await Zotero.Fulltext.getPages(attachment.id);
			// getPages 的 SQL 是 SELECT indexedPages, totalPages AS total，
			// 总页数字段叫 total，不叫 totalPages。没索引过时没有这一行。
			if (info && info.total) {
				return { indexedPages: info.indexedPages || 0, totalPages: info.total };
			}
		}
		catch (e) {
			// 没索引过会拿不到，不算错误
		}
		return { indexedPages: 0, totalPages: 0 };
	}

	/** 读全文缓存。拿不到就返回 null，让调用方决定下一步。 */
	async function readCache(attachment) {
		var file = null;
		try {
			file = Zotero.Fulltext.getItemCacheFile(attachment);
		}
		catch (e) {
			Zotero.debug('[英文助手·词频] 取全文缓存失败：' + e);
			return null;
		}
		if (!file) {
			return null;
		}
		var path = file.path || null;
		if (!path) {
			return null;
		}
		if (!(await WordFreq.output.existsAsync(path))) {
			return null;
		}
		try {
			var text = await WordFreq.output.readTextAsync(path);
			if (!text || !text.length) {
				return null;
			}
			return { text: text, path: path };
		}
		catch (e) {
			Zotero.debug('[英文助手·词频] 读全文缓存出错：' + e);
			return null;
		}
	}

	/**
	 * 纯函数：全文缓存覆盖了多少页。抽出来是为了能离线测——
	 * 这一步决定统计的是整本书还是前 100 页，是整个插件里后果最重的判断。
	 *
	 * @param {{indexedPages: number, totalPages: number}} pages
	 * @returns {'complete'|'partial'|'unknown'}
	 */
	function coverageOf(pages) {
		if (!pages || !pages.totalPages || !pages.indexedPages) {
			return 'unknown';
		}
		return pages.indexedPages < pages.totalPages ? 'partial' : 'complete';
	}

	/** 现场提取 PDF 文字层 */
	async function extract(attachment) {
		// 第二个参数 maxPages 传 null 表示提取全部页。
		// Zotero 自己建全文索引时调的是 getFullText(itemID, pdfMaxPages)，
		// 默认只提前 100 页。整本书要拿全，就得显式传 null。
		var result = await Zotero.PDFWorker.getFullText(attachment.id, null);
		var text = (result && result.text) || '';
		return {
			text: text,
			extractedPages: (result && result.extractedPages) || 0,
			totalPages: (result && result.totalPages) || 0,
		};
	}

	/**
	 * 取正文。
	 *
	 * @param {object} attachment PDF 附件
	 * @param {object} opts textSource: auto | cache | extract
	 * @returns {Promise<{text: string, source: string, pages: number, totalPages: number, note: string}>}
	 */
	async function getText(attachment, opts) {
		opts = opts || {};
		var mode = opts.textSource || 'auto';
		var pages = await pagesOf(attachment);
		var hasPageInfo = pages.totalPages > 0;

		// EPUB 没有页码，也用不了 PDFWorker：只认 Zotero 的全文缓存
		if (isEpubAttachment(attachment)) {
			var cachedEpub = await readCache(attachment);
			if (!cachedEpub) {
				throw new Error('这篇 EPUB 还没有全文索引。在 Zotero 里选中它，'
					+ '右键「重建全文索引」，或等自动索引完成后再试一次。');
			}
			return {
				text: cachedEpub.text,
				source: 'cache',
				pages: 0,
				totalPages: 0,
				note: '取自 Zotero 全文缓存（EPUB）',
			};
		}

		// 判断缓存有没有被截断，看的是页数，不是字符数。
		// Zotero 建索引时只调 getFullText(itemID, pdfMaxPages)，默认 100 页；
		// 超过 100 页的文献，.zotero-ft-cache 里干脆没有后面的页，
		// 而它看起来仍然是一份完整的文本，光看字符数是发现不了的。
		var cacheIsPartial = coverageOf(pages) === 'partial';

		if (mode !== 'extract') {
			var cached = await readCache(attachment);
			if (cached) {
				if (!cacheIsPartial) {
					return {
						text: cached.text,
						source: 'cache',
						pages: pages.indexedPages,
						totalPages: pages.totalPages,
						note: '取自 Zotero 全文缓存'
							+ (hasPageInfo ? '，' + pages.indexedPages + ' / ' + pages.totalPages + ' 页' : ''),
					};
				}
				if (mode === 'cache') {
					return {
						text: cached.text,
						source: 'cache',
						pages: pages.indexedPages,
						totalPages: pages.totalPages,
						note: '取自 Zotero 全文缓存，但它只覆盖 ' + pages.indexedPages + ' / '
							+ pages.totalPages + ' 页，后面的页没有计入',
					};
				}
				Zotero.debug('[英文助手·词频] 全文缓存只覆盖 ' + pages.indexedPages + ' / '
					+ pages.totalPages + ' 页，改走现场提取');
			}
			else if (mode === 'cache') {
				throw new Error('这篇文献还没有建全文缓存。请先在 Zotero 里给它做一次全文索引，'
					+ '或把设置里的取文本方式改成「总是现场提取」。');
			}
		}

		var extracted = await extract(attachment);
		if (!extracted.text || !extracted.text.trim().length) {
			throw new Error('没能从 PDF 里提取到文字层。这多半是扫描件，'
				+ '需要先做 OCR 才能统计词频。');
		}

		var note = '现场提取';
		if (extracted.totalPages && extracted.extractedPages) {
			note += '，' + extracted.extractedPages + ' / ' + extracted.totalPages + ' 页';
			if (extracted.extractedPages < extracted.totalPages) {
				note += '（后 ' + (extracted.totalPages - extracted.extractedPages)
					+ ' 页没有文字层，未计入）';
			}
		}

		return {
			text: extracted.text,
			source: 'extract',
			pages: extracted.extractedPages,
			totalPages: extracted.totalPages || pages.totalPages,
			note: note,
		};
	}

	return {
		isPdfAttachment: isPdfAttachment,
		findPdf: findPdf,
		findTextSource: findTextSource,
		isTextAttachment: isTextAttachment,
		isEpubAttachment: isEpubAttachment,
		pathOf: pathOf,
		pagesOf: pagesOf,
		coverageOf: coverageOf,
		readCache: readCache,
		extract: extract,
		getText: getText,
	};
})();
