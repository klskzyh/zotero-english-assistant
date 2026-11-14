/* 译文卡片上的「本书出现几次」。
 *
 * 只从该文献的词频表里查：PDF 同目录那份 `_wordfreq.csv`，也就是用户在词频区块里
 * 看到的那份数据。表里有这个词就显示次数，没有就不显示。
 *
 * 只读表、不现场统计。原因是现场统计要重新取全文、重新切词，慢且口径容易和表对不上，
 * 用户也明确说过「没办法现场统计也没关系，就不显示好了」。
 * 拿不到表、读不出文件、查不到词，一律安静地不显示，不影响翻译。
 */

DeepSeekTranslate.counts = {
	// attachmentItemID -> Promise<{from, counts}|null>
	_indexes: new Map(),

	/** 清空缓存。词频表重新生成过之后调用，或者等插件重启自然失效。 */
	clear() {
		this._indexes.clear();
	},

	forAttachment(attachment) {
		var key = attachment && attachment.id;
		if (!key) {
			return Promise.resolve(null);
		}
		if (!this._indexes.has(key)) {
			this._indexes.set(key, this._build(attachment).catch(function (e) {
				DeepSeekTranslate.log('[词次] 读词频表失败：' + ((e && e.message) || e));
				return null;
			}));
		}
		return this._indexes.get(key);
	},

	async _build(attachment) {
		var W = (typeof WordFreq !== 'undefined') ? WordFreq : null;
		if (!W || !W.output || !W.wordfreq || !W.source) {
			return null;
		}
		var pdfPath = await W.source.pathOf(attachment);
		if (!pdfPath) {
			return null;
		}
		var outPath = await W.output.findCsvAsync(pdfPath, W.prefGet('suffix', '_wordfreq'));
		if (!outPath) {
			return null;
		}
		var parsed = W.wordfreq.parseCsv(await W.output.readTextAsync(outPath));
		if (!parsed || !parsed.rows || !parsed.rows.length) {
			return null;
		}
		var index = { from: '词频表', counts: new Map() };
		parsed.rows.forEach(function (row) {
			DeepSeekTranslate.counts._addRow(index, row);
		});
		DeepSeekTranslate.log('[词次] 词频表索引：' + index.counts.size + ' 个词（' + outPath + '）');
		return index;
	},

	/** 把一行词频记进索引：词元本身，以及 forms 列里的各个词形（dog:3; dogs:1） */
	_addRow(index, row) {
		var word = String((row && row.word) || '').toLowerCase();
		if (word && !index.counts.has(word)) {
			index.counts.set(word, Number(row.count) || 0);
		}
		String((row && row.forms) || '').split(';').forEach(function (part) {
			var bits = part.split(':');
			if (bits.length !== 2) {
				return;
			}
			var form = bits[0].trim().toLowerCase();
			var count = Number(bits[1]);
			if (form && isFinite(count) && !index.counts.has(form)) {
				index.counts.set(form, count);
			}
		});
	},

	/** 纯函数：从索引里按优先级挑一个词次 */
	pickFromIndex(index, keys) {
		if (!index || !index.counts || !index.counts.size) {
			return null;
		}
		for (var i = 0; i < keys.length; i++) {
			var key = String(keys[i] == null ? '' : keys[i]).trim().toLowerCase();
			if (key && index.counts.has(key)) {
				return { count: index.counts.get(key), from: index.from };
			}
		}
		return null;
	},

	/**
	 * 一条翻译记录该显示的数字。只对单词查表：短语不在这张按词统计的表里。
	 * @returns {Promise<{count: number, from: string}|null>}
	 */
	async forEntry(attachment, entry) {
		var data = entry && entry.data;
		if (!data || typeof data !== 'object' || data.type !== 'word') {
			return null;
		}
		var index = await this.forAttachment(attachment);
		// 词元优先，其次表层形式：表里存的是归并后的词元
		return this.pickFromIndex(index, [
			data.form && data.form.lemma,
			data.headword,
			data.form && data.form.surface,
			entry.text,
		]);
	},
};
