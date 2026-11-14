/* 单词本：收藏翻译结果、落盘、在一个独立窗口里按 3×3 卡片浏览。
 *
 * 存储位置：<Zotero 数据目录>/english-assistant/wordbook.json
 * 写入用「先写 .tmp 再改名」保证原子性；读入时 JSON 坏了先把原文件改名备份，
 * 再当空本处理，绝不直接覆盖掉用户的数据。
 *
 * 页面 wordbook.xhtml 只提供骨架（网格容器 + 翻页控件），卡片由 fillWindow() 现建，
 * 逻辑不往页面里再写一份。
 *
 * 纯函数（keyOf / entryFromTranslation / mergeInto / pageOf）单独拆出来，离线自测能直接测。
 */

DeepSeekTranslate.wordbook = {
	FILE_NAME: 'wordbook.json',
	PER_PAGE: 9,

	// 内存里的条目：按加入顺序正序排列，最早加的在前（用户要求）
	_entries: null,
	_loading: null,
	// 本次会话里已经尝试补过词典信息的条目（失败也不反复重试）
	_tried: new Set(),

	// ── 文件与路径 ───────────────────────────────────────

	_ioUtils() {
		try {
			if (typeof IOUtils !== 'undefined' && IOUtils) {
				return IOUtils;
			}
		}
		catch (e) {
			// 忽略
		}
		try {
			return ChromeUtils.importESModule('resource://gre/modules/IOUtils.sys.mjs').IOUtils;
		}
		catch (e) {
			return null;
		}
	},

	_pathUtils() {
		try {
			if (typeof PathUtils !== 'undefined' && PathUtils) {
				return PathUtils;
			}
		}
		catch (e) {
			// 忽略
		}
		try {
			return ChromeUtils.importESModule('resource://gre/modules/PathUtils.sys.mjs').PathUtils;
		}
		catch (e) {
			return null;
		}
	},

	dirPath() {
		var base = (Zotero.DataDirectory && Zotero.DataDirectory.dir) || '';
		if (!base) {
			throw new Error('拿不到 Zotero 数据目录');
		}
		var PU = this._pathUtils();
		var name = 'english-assistant';
		return PU ? PU.join(base, name) : base + '\\' + name;
	},

	filePath() {
		var PU = this._pathUtils();
		var dir = this.dirPath();
		return PU ? PU.join(dir, this.FILE_NAME) : dir + '\\' + this.FILE_NAME;
	},

	// ── 读入与写盘 ───────────────────────────────────────

	/** 读进内存，只读一次；并发调用共用同一个加载过程 */
	load() {
		var self = this;
		if (this._entries) {
			return Promise.resolve(this._entries);
		}
		if (!this._loading) {
			this._loading = (async function () {
				var text = '';
				try {
					var IOU = self._ioUtils();
					if (IOU && typeof IOU.readUTF8 === 'function') {
						text = await IOU.readUTF8(self.filePath());
					}
				}
				catch (e) {
					// 文件还不存在是正常的
					text = '';
				}

				var list = [];
				var migrated = false;
				if (text) {
					try {
						var json = JSON.parse(text);
						list = Array.isArray(json)
							? json
							: (json && Array.isArray(json.entries) ? json.entries : []);
						// 版本 1 的文件是「最新在前」，1.5.4 起改成按加入顺序正序存放，
						// 读旧文件时倒一次，免得新旧混着排
						var ver = Array.isArray(json) ? 1 : (Number(json && json.version) || 1);
						if (ver < 2) {
							list = list.slice().reverse();
							migrated = true;
						}
					}
					catch (e) {
						await self.backupBrokenFile();
						DeepSeekTranslate.logError('单词本文件损坏，已备份并重建', e);
						list = [];
					}
				}

				self._entries = list.filter(function (item) {
					return item && (item.lemma || item.surface);
				});
				self._loading = null;
				if (migrated) {
					// 顺手把新顺序写回去，之后就不用每次倒了
					self.save().catch(function () {});
				}
				return self._entries;
			})();
		}
		return this._loading;
	},

	/** 坏文件先改名留档，别直接盖掉 */
	async backupBrokenFile() {
		try {
			var IOU = this._ioUtils();
			var path = this.filePath();
			var stamp = new Date().toISOString().replace(/[:.]/g, '-');
			if (IOU && typeof IOU.move === 'function') {
				await IOU.move(path, path + '.broken-' + stamp);
			}
		}
		catch (e) {
			DeepSeekTranslate.logError('备份损坏的单词本失败', e);
		}
	},

	/** 原子写：先写 .tmp 再改名 */
	async save() {
		await this.load();
		var IOU = this._ioUtils();
		var path = this.filePath();
		var text = JSON.stringify({ version: 2, entries: this._entries }, null, 2);

		if (!IOU || typeof IOU.writeUTF8 !== 'function') {
			await Zotero.File.putContentsAsync(path, text);
			return;
		}

		try {
			if (typeof IOU.makeDirectory === 'function') {
				await IOU.makeDirectory(this.dirPath(), {
					createAncestors: true,
					ignoreExisting: true,
				});
			}
			var tmp = path + '.tmp';
			await IOU.writeUTF8(tmp, text);
			await IOU.move(tmp, path);
		}
		catch (e) {
			DeepSeekTranslate.logError('单词本写入失败', e);
			throw e;
		}
	},

	// ── 纯函数 ───────────────────────────────────────────

	/**
	 * 去重用的键：词元（或短语原形），小写。
	 * 既接受单词本条目，也接受翻译记录（数据在 `entry.data` 里、原文在 `entry.text`），
	 * 这样「移除收藏」直接拿翻译记录来也对得上。
	 */
	keyOf(item) {
		if (!item) {
			return '';
		}
		var raw = item.lemma || item.headword || item.phrase || item.surface;
		if (!raw && item.data && typeof item.data === 'object') {
			raw = item.data.headword || item.data.phrase;
		}
		if (!raw && item.text) {
			raw = item.text;
		}
		return String(raw == null ? '' : raw).trim().toLowerCase();
	},

	/** 把一条翻译记录整理成单词本条目；句子与段落不收 */
	entryFromTranslation(entry) {
		var data = (entry && entry.data) || null;
		if (!data || (data.type !== 'word' && data.type !== 'phrase')) {
			return null;
		}
		var ctx = (data.inContext && typeof data.inContext === 'object') ? data.inContext : {};
		var meaning = typeof data.inContext === 'string' ? data.inContext : '';
		// 短语以 AI 给的完整形式为准：用户划选可能多了或少了几个字母。
		// 单词仍保留划选到的那个词形（surface），lemma 取 headword。
		var isPhrase = data.type === 'phrase';
		var canonical = isPhrase
			? (data.phrase || data.headword || '')
			: (data.headword || '');
		var surface = isPhrase
			? (canonical || entry.text || '')
			: (entry.text || canonical || '');
		return {
			id: 'wb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
			lemma: canonical || entry.text || '',
			surface: surface,
			type: data.type,
			pronunciation: data.pronunciation || '',
			gloss: ctx.gloss || meaning || '',
			note: ctx.note || '',
			sentence: ctx.sentence || '',
			sentenceTranslation: ctx.sentenceTranslation || '',
			senses: Array.isArray(data.senses) ? data.senses : [],
			examples: Array.isArray(data.examples) ? data.examples : [],
			explanation: data.explanation || '',
			count: (entry.count && entry.count.count) || 0,
			addedAt: Date.now(),
			seenCount: 1,
		};
	},

	/** 加同一条时只更新计数，不重复占位 */
	mergeInto(list, item) {
		var key = this.keyOf(item);
		if (!key) {
			return { added: false, entry: null };
		}
		for (var i = 0; i < list.length; i++) {
			if (this.keyOf(list[i]) === key) {
				list[i].seenCount = (Number(list[i].seenCount) || 1) + 1;
				list[i].lastSeenAt = item.addedAt;
				return { added: false, entry: list[i] };
			}
		}
		list.push(item);
		return { added: true, entry: item };
	},

	/** 分页：每页 9 张，页码超出范围时夹到最近的一页 */
	/**
	 * 只是显示顺序：reverse 把当前页整个翻过来，shuffle 打乱一份副本，
	 * normal 原样。都返回新数组，绝不改动传进来的列表。
	 */
	orderedForDisplay(list, mode) {
		var out = list.slice();
		if (mode === 'reverse') {
			out.reverse();
			return out;
		}
		if (mode === 'shuffle') {
			for (var i = out.length - 1; i > 0; i--) {
				var j = Math.floor(Math.random() * (i + 1));
				var tmp = out[i];
				out[i] = out[j];
				out[j] = tmp;
			}
		}
		return out;
	},

	pageOf(list, page, per) {
		var size = per || this.PER_PAGE;
		var all = list || [];
		var total = Math.max(1, Math.ceil(all.length / size));
		var n = Math.min(Math.max(1, Number(page) || 1), total);
		var start = (n - 1) * size;
		return { page: n, pageCount: total, items: all.slice(start, start + size) };
	},

	// ── 对外操作 ─────────────────────────────────────────

	/**
	 * 单词本变了：让翻译面板与词频区块都重画一遍。
	 * 不这么做的话，在单词本窗口里移除一个词，词频表那一行的星标会停在旧状态。
	 */
	notifyChanged() {
		try {
			if (typeof DeepSeekTranslate !== 'undefined' && DeepSeekTranslate.refreshPanels) {
				// 不传附件 ID 表示刷新所有翻译面板
				DeepSeekTranslate.refreshPanels();
			}
		}
		catch (e) {
			DeepSeekTranslate.logError('刷新翻译面板失败', e);
		}
		try {
			if (typeof WordFreq !== 'undefined' && WordFreq.pane && WordFreq.pane.refreshAll) {
				WordFreq.pane.refreshAll();
			}
		}
		catch (e) {
			DeepSeekTranslate.logError('刷新词频区块失败', e);
		}
	},

	async add(entry) {
		await this.load();
		var item = this.entryFromTranslation(entry);
		if (!item) {
			return { added: false, entry: null, reason: '只收单词和短语' };
		}
		var result = this.mergeInto(this._entries, item);
		await this.save();
		this.notifyChanged();
		if (result.added) {
			// 第一次收藏：后台补音标与词典释义（只把单词本身发给模型）
			this._tried.add(result.entry.id);
			this.ensureDetails(result.entry);
		}
		return result;
	},

	/** 词频区块用：手上只有词本身 */
	async addWord(word) {
		var text = String(word == null ? '' : word).trim();
		if (!text) {
			return { added: false, entry: null, reason: '空的词' };
		}
		return this.add({ text: text, data: { type: 'word', headword: text } });
	},

	/**
	 * 给条目补音标与词典释义（按词性列出的全部常用义项）。
	 * 这一步模型只看到那个词本身；已经有就跳过；失败只记日志，不影响收藏本身。
	 */
	async ensureDetails(item) {
		if (!item) {
			return item;
		}
		if (item.pronunciation && Array.isArray(item.dictSenses) && item.dictSenses.length) {
			return item;
		}
		var D = DeepSeekTranslate;
		try {
			var result = await D.api.chat(D.prompts.dictionaryMessages(item.lemma || item.surface), { json: true });
			var parsed = D.service.parse(result.content);
			if (!parsed) {
				return item;
			}
			item.pronunciation = String(parsed.pronunciation || item.pronunciation || '').trim();
			item.dictSenses = this.sensesFromDict(parsed);
			item.detailsAt = Date.now();
			await this.save();
		}
		catch (e) {
			D.logError('取词典信息失败：' + ((item && (item.lemma || item.surface)) || ''), e);
		}
		return item;
	},

	/** 把模型给的 senses 整理成 [{pos, meaning}]，兼容它只给单条 pos/meaning 的情况 */
	sensesFromDict(parsed) {
		var out = [];
		var list = Array.isArray(parsed && parsed.senses) ? parsed.senses : [];
		list.forEach(function (sense) {
			if (!sense || typeof sense !== 'object') {
				return;
			}
			var pos = String(sense.pos || '').trim();
			var meaning = String(sense.meaning || '').trim();
			if (pos || meaning) {
				out.push({ pos: pos, meaning: meaning });
			}
		});
		if (!out.length) {
			var pos = String((parsed && parsed.pos) || '').trim();
			var meaning = String((parsed && parsed.meaning) || '').trim();
			if (pos || meaning) {
				out.push({ pos: pos, meaning: meaning });
			}
		}
		return out;
	},

	/** 卡片上的释义行：每个词性一行，最多留 limit 行 */
	dictLines(item, limit) {
		var max = limit || 5;
		var out = [];
		var list = Array.isArray(item && item.dictSenses) ? item.dictSenses : [];
		list.forEach(function (sense) {
			var pos = String(sense && sense.pos || '').trim();
			var meaning = String(sense && sense.meaning || '').trim();
			if (!meaning) {
				return;
			}
			out.push(pos ? pos + ' ' + meaning : meaning);
		});
		if (!out.length) {
			var single = this.dictLine(item);
			if (single) {
				out.push(single);
			}
		}
		return out.slice(0, max);
	},


	/** 卡片上那行词典释义：有词性就拼在前面 */
	dictLine(item) {
		var pos = String((item && item.dictPos) || '').trim();
		var meaning = String((item && (item.dictMeaning || item.gloss)) || '').trim();
		if (!meaning) {
			return pos;
		}
		return pos ? pos + ' ' + meaning : meaning;
	},

	async remove(id) {
		await this.load();
		var before = this._entries.length;
		this._entries = this._entries.filter(function (item) {
			return item.id !== id;
		});
		if (this._entries.length !== before) {
			await this.save();
			this.notifyChanged();
		}
	},

	/** 纯函数：从列表里去掉一批 id，返回新列表与去掉的条数 */
	withoutIds(list, ids) {
		var set = new Set(ids || []);
		var all = list || [];
		var out = all.filter(function (item) {
			return !set.has(item.id);
		});
		return { list: out, removed: all.length - out.length };
	},

	/** 一次移除多条（窗口里「移除一整页」用），只写一次盘 */
	async removeMany(ids) {
		await this.load();
		var result = this.withoutIds(this._entries, ids);
		if (!result.removed) {
			return 0;
		}
		this._entries = result.list;
		await this.save();
		this.notifyChanged();
		return result.removed;
	},

	/** 按键元移除（翻译卡片上「移除收藏」用） */

	async removeByKey(item) {
		await this.load();
		var key = this.keyOf(item);
		if (!key) {
			return false;
		}
		var target = null;
		for (var i = 0; i < this._entries.length; i++) {
			if (this.keyOf(this._entries[i]) === key) {
				target = this._entries[i];
				break;
			}
		}
		if (!target) {
			return false;
		}
		await this.remove(target.id);
		return true;
	},

	/** 按词移除（词频区块用） */
	async removeByWord(word) {
		return this.removeByKey({ lemma: word, surface: word });
	},

	/** 同步判断某个词在不在单词本里（词频区块渲染时用，前提是先 load 过） */
	isWordCollected(word) {
		var key = this.keyOf({ lemma: word, surface: word });
		if (!key || !this._entries) {
			return false;
		}
		var self = this;
		return this._entries.some(function (item) {
			return self.keyOf(item) === key;
		});
	},

	all() {
		return this._entries || [];
	},

	/** 同步判断是否已收藏：内存还没读入时返回 false，读入后按词元判断 */
	isCollected(entry) {
		var data = (entry && entry.data) || {};
		if (data.type !== 'word' && data.type !== 'phrase') {
			return false;
		}
		if (!this._entries) {
			return false;
		}
		var key = this.keyOf({
			lemma: data.headword || data.phrase,
			surface: entry.text,
		});
		var self = this;
		return this._entries.some(function (item) {
			return self.keyOf(item) === key;
		});
	},

	// ── 窗口 ─────────────────────────────────────────────

	openWindow() {
		var self = this;
		var url = 'chrome://english-assistant/content/wordbook.xhtml';
		var win = null;
		try {
			win = Zotero.getMainWindow().openDialog(url, 'ea-wordbook',
				'chrome,centerscreen,resizable,width=900,height=760', null);
		}
		catch (e) {
			DeepSeekTranslate.logError('打开单词本窗口失败', e);
			return null;
		}
		if (!win) {
			return null;
		}

		var fill = function () {
			self.fillWindow(win).catch(function (e) {
				DeepSeekTranslate.logError('填充单词本失败', e);
			});
		};
		try {
			if (win.document && win.document.readyState === 'complete') {
				fill();
			}
			else {
				win.addEventListener('load', fill, { once: true });
			}
		}
		catch (e) {
			DeepSeekTranslate.logError('等待单词本窗口加载失败', e);
		}
		return win;
	},

	async fillWindow(win) {
		await this.load();
		var doc = win.document;
		if (!doc) {
			return;
		}
		var state = win.__eaWordbook || (win.__eaWordbook = { page: 1 });
		var grid = doc.getElementById('ea-wordbook-grid');
		var info = doc.getElementById('ea-wordbook-pageinfo');
		var countLabel = doc.getElementById('ea-wordbook-count');
		var empty = doc.getElementById('ea-wordbook-empty');
		var prev = doc.getElementById('ea-wordbook-prev');
		var next = doc.getElementById('ea-wordbook-next');
		var removePage = doc.getElementById('ea-wordbook-remove-page');
		var orderSel = doc.getElementById('ea-wordbook-order');
		var modeSel = doc.getElementById('ea-wordbook-mode');
		// 逆向/乱序只是这一次窗口会话里的显示效果，重开窗口就回到默认顺序
		this._orderMode = 'normal';
		// 显示模式同样只在这次窗口里有效
		this._displayMode = 'both';
		if (!grid) {
			return;
		}

		var self = this;
		var XHTML = 'http://www.w3.org/1999/xhtml';
		var make = function (tag, className, text) {
			var el = doc.createElementNS(XHTML, tag);
			if (className) {
				el.className = className;
			}
			if (text != null) {
				el.textContent = String(text);
			}
			return el;
		};

		/**
		 * 按显示模式往卡片里填内容。卡片第一个子元素是右上角的移除按钮，
		 * 所以重填时保留第一个、其余整个清掉。
		 */
		var addContent = function (card, item, mode) {
			while (card.children.length > 1) {
				card.removeChild(card.lastChild);
			}
			card.classList.remove('ea-wb-center');
			card.classList.toggle('ea-wb-clickable', mode !== 'both');

			var word = String(item.surface || item.lemma || '');
			var means = self.dictLines(item, 4);

			if (mode === 'blank') {
				return;
			}
			if (mode === 'en') {
				// 仅英文：只在正中间显示词本身
				card.classList.add('ea-wb-center');
				card.appendChild(make('div', 'ea-wb-word', word));
				return;
			}
			if (mode === 'zh') {
				// 仅中文：不给词和音标，只列释义
				means.forEach(function (line) {
					card.appendChild(make('div', 'ea-wb-mean', line));
				});
				return;
			}
			card.appendChild(make('div', 'ea-wb-word', word));
			var pron = String(item.pronunciation || '').trim();
			if (pron) {
				card.appendChild(make('div', 'ea-wb-pron', pron));
			}
			means.forEach(function (line) {
				card.appendChild(make('div', 'ea-wb-mean', line));
			});
		};

		var paint = function () {
			var page = self.pageOf(self.all(), state.page);
			state.page = page.page;
			state.lastPage = page.items;
			// 条目数一变（加了词或移了词）就退回默认顺序，这是用户要的
			if (self._orderCount !== undefined && self._orderCount !== self.all().length) {
				self._orderMode = 'normal';
			}
			self._orderCount = self.all().length;
			grid.textContent = '';
			// 逆向/乱序只换显示顺序，不动真实数据，也不影响翻页与移除
			var shown = self.orderedForDisplay(page.items, self._orderMode);
			if (orderSel) {
				orderSel.value = self._orderMode || 'normal';
			}
			if (modeSel) {
				modeSel.value = self._displayMode || 'both';
			}
			shown.forEach(function (item) {
				var card = make('div', 'ea-wb-card');
				card.setAttribute('title', (item.lemma || item.surface || ''));

				// 右上角：移出单词本（点了先确认）
				var remove = make('span', 'ea-wb-remove', '✕');
				remove.setAttribute('title', '移出单词本');
				remove.setAttribute('role', 'button');
				remove.addEventListener('click', function (event) {
					event.stopPropagation();
					self.removeFromWindow(win, item, paint);
				});
				card.appendChild(remove);

				var mode = self._displayMode || 'both';
				addContent(card, item, mode);
				// 非「中英文」模式下点卡片就临时翻成完整内容（右上角 ✕ 除外）。
				// 只是这一次渲染里的效果：重画（翻页、换模式、增删词）就没了。
				if (mode !== 'both') {
					card.addEventListener('click', function (event) {
						var target = event.target;
						if (target && target.classList
							&& target.classList.contains('ea-wb-remove')) {
							return;
						}
						addContent(card, item, 'both');
					});
				}

				grid.appendChild(card);
			});

			if (info) {
				info.setAttribute('value', '第 ' + page.page + ' / ' + page.pageCount + ' 页');
			}
			if (countLabel) {
				countLabel.setAttribute('value', '共 ' + self.all().length + ' 个');
			}
			if (empty) {
				empty.style.display = page.items.length ? 'none' : 'block';
			}
			if (prev) {
				prev.disabled = page.page <= 1;
			}
			if (next) {
				next.disabled = page.page >= page.pageCount;
			}
			if (removePage) {
				removePage.disabled = page.items.length === 0;
			}

			// 这一页上还没有音标与释义的，逐条补一次（每页最多 9 条），补完再画一遍
			var missing = page.items.filter(function (item) {
				return !item.dictMeaning && !self._tried.has(item.id);
			});
			if (missing.length) {
				missing.forEach(function (item) {
					self._tried.add(item.id);
				});
				(async function () {
					for (var i = 0; i < missing.length; i++) {
						await self.ensureDetails(missing[i]);
					}
					paint();
				})();
			}
		};

		var go = function (delta) {
			var page = self.pageOf(self.all(), state.page + delta);
			state.page = page.page;
			paint();
		};

		if (!win.__eaWordbookWired) {
			win.__eaWordbookWired = true;
			if (prev) {
				prev.addEventListener('command', function () { go(-1); });
			}
			if (next) {
				next.addEventListener('command', function () { go(1); });
			}
			var removePageBtn = doc.getElementById('ea-wordbook-remove-page');
			if (removePageBtn) {
				removePageBtn.addEventListener('command', function () {
					self.removePageFromWindow(win, paint);
				});
			}
			if (orderSel) {
				orderSel.addEventListener('command', function () {
					self._orderMode = orderSel.value || 'normal';
					paint();
				});
			}
			if (modeSel) {
				modeSel.addEventListener('command', function () {
					self._displayMode = modeSel.value || 'both';
					paint();
				});
			}
		}

		paint();
	},

	/** 窗口里点「移除一整页」：先确认，再把当前页的词一次移出 */
	async removePageFromWindow(win, repaint) {
		var state = (win && win.__eaWordbook) || {};
		var items = state.lastPage || [];
		if (!items.length) {
			return;
		}
		var ok = await DeepSeekTranslate.confirm(win, '移除一整页',
			'把这一页的 ' + items.length + ' 个词都移出单词本？');
		if (!ok) {
			return;
		}
		await this.removeMany(items.map(function (item) {
			return item.id;
		}));
		if (typeof repaint === 'function') {
			repaint();
		}
	},

	/** 窗口里点卡片右上角的 ✕：先确认，再去掉，最后重画 */
	async removeFromWindow(win, item, repaint) {
		var ok = await DeepSeekTranslate.confirm(win, '移出单词本',
			'把「' + (item.surface || item.lemma || '') + '」移出单词本？');
		if (!ok) {
			return;
		}
		await this.remove(item.id);
		if (typeof repaint === 'function') {
			repaint();
		}
	},
};
