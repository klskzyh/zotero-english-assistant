/* 把模型返回的 JSON 变成面板里的 DOM。
 *
 * 所有来自模型或文献的文字都走 textContent，不拼 innerHTML，
 * 免得译文里的 < > 被当成标签解析。 */

DeepSeekTranslate.render = {
	el(doc, tag, className, text) {
		var node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
		if (className) {
			node.setAttribute('class', className);
		}
		if (text !== undefined && text !== null && text !== '') {
			node.textContent = String(text);
		}
		return node;
	},

	button(doc, className, label, onClick) {
		var btn = this.el(doc, 'button', className, label);
		btn.setAttribute('type', 'button');
		btn.addEventListener('click', function (event) {
			event.preventDefault();
			event.stopPropagation();
			onClick(event);
		});
		return btn;
	},

	/** 一条历史记录的卡片 */
	entryCard(doc, entry, handlers) {
		var self = this;
		var card = this.el(doc, 'div', 'ds-entry');

		var head = this.el(doc, 'div', 'ds-entry-head');
		var badge = this.el(doc, 'span', 'ds-badge');
		var label = entry.data && DeepSeekTranslate.prompts.TYPE_LABEL[entry.data.type];
		badge.textContent = label || (entry.error ? '失败' : '结果');
		if (entry.error) {
			badge.setAttribute('class', 'ds-badge ds-badge-error');
		}
		head.appendChild(badge);

		if (entry.pageLabel) {
			head.appendChild(this.el(doc, 'span', 'ds-meta', entry.pageLabel));
		}
		head.appendChild(this.el(doc, 'span', 'ds-meta', DeepSeekTranslate.formatTime(entry.at)));

		var actions = this.el(doc, 'span', 'ds-actions');
		// 单词本只收单词和短语；已经在单词本里时，按钮变成「移除收藏」
		var kind = entry.data && entry.data.type;
		if (handlers.onCollect && !entry.error && (kind === 'word' || kind === 'phrase')) {
			var collected = !!(handlers.isCollected && handlers.isCollected(entry));
			var collectBtn = this.button(doc, 'ds-link', collected ? '移除收藏' : '收藏', function () {
				if (collectBtn.disabled) {
					return;
				}
				var inBook = collectBtn.dataset && collectBtn.dataset.collected === '1';
				if (inBook && handlers.onUncollect) {
					handlers.onUncollect(entry, collectBtn);
				}
				else {
					handlers.onCollect(entry, collectBtn);
				}
			});
			if (collectBtn.dataset) {
				collectBtn.dataset.collected = collected ? '1' : '0';
			}
			actions.appendChild(collectBtn);
		}
		actions.appendChild(this.button(doc, 'ds-link', '复制', function () {
			handlers.onCopy(DeepSeekTranslate.render.copyText(entry));
		}));
		actions.appendChild(this.button(doc, 'ds-link', '删除', function () {
			handlers.onDelete(entry.id);
		}));
		head.appendChild(actions);
		card.appendChild(head);

		// 原文片段。词和短语的 headword 与选中内容相同时它就是标题，不必再多一行
		var headwordForSource = entry.data && (entry.data.headword || entry.data.phrase);
		var sameAsHeadword = !!headwordForSource &&
			String(entry.text || '').trim().toLowerCase() === String(headwordForSource).trim().toLowerCase();
		if (entry.text && !sameAsHeadword) {
			var sourceBox = this.el(doc, 'div', 'ds-block');
			sourceBox.appendChild(this.el(doc, 'div', 'ds-label', '原文'));
			sourceBox.appendChild(this.el(doc, 'div', 'ds-source', entry.text));
			card.appendChild(sourceBox);
		}

		if (entry.error) {
			card.appendChild(this.el(doc, 'div', 'ds-error', entry.error));
			return card;
		}

		card.appendChild(this.resultBody(doc, entry.data, entry.text, entry.count));

		var footerBits = [];
		if (entry.model) {
			footerBits.push(entry.model);
		}
		if (entry.usage && entry.usage.total_tokens) {
			footerBits.push(entry.usage.total_tokens + ' tokens');
		}
		if (entry.contextNote) {
			footerBits.push(entry.contextNote);
		}
		if (footerBits.length) {
			card.appendChild(this.el(doc, 'div', 'ds-footer', footerBits.join(' · ')));
		}

		if (entry.contextText) {
			var details = this.el(doc, 'details', 'ds-details');
			details.appendChild(this.el(doc, 'summary', null, '查看本次使用的上下文'));
			details.appendChild(this.el(doc, 'pre', 'ds-context', entry.contextText));
			card.appendChild(details);
		}

		return card;
	},

	/** 这一栏放的是译文，还是母语幼儿模式下的简单英文复述 */
	textLabel() {
		return DeepSeekTranslate.prefString('explainMode', 'zh') === 'en-simple'
			? '简单英文复述'
			: '译文';
	},

	/** 本书词次徽标 */
	countBadge(doc, count) {
		var badge = this.el(doc, 'span', 'ds-count', count.count + ' 次');
		badge.setAttribute('title', '本书中共出现 ' + count.count + ' 次'
			+ (count.from ? '（据' + count.from + '）' : ''));
		return badge;
	},

	/**
	 * 母语幼儿模式的卡片：词条一行，下面跟着两到三段简单英文。
	 * 不加任何区块标题——用户要的就是「一段话讲明白」。
	 */
	kidBody(doc, data, count) {
		var box = this.el(doc, 'div', 'ds-result ds-kid');
		var headword = data.headword || '';
		if (headword) {
			var title = this.el(doc, 'div', 'ds-headword');
			title.appendChild(this.el(doc, 'span', 'ds-word', headword));
			if (data.pronunciation) {
				title.appendChild(this.el(doc, 'span', 'ds-pron', data.pronunciation));
			}
			if (count && count.count > 0) {
				title.appendChild(this.countBadge(doc, count));
			}
			box.appendChild(title);
		}
		data.kidParagraphs.forEach(function (text) {
			var para = DeepSeekTranslate.render.el(doc, 'p', 'ds-kid-p');
			DeepSeekTranslate.render.fillKidText(doc, para, text);
			box.appendChild(para);
		});
		return box;
	},

	/**
	 * 幼儿模式的段落文本：把 **粗体** 与 ==彩色== 渲染成节点，其余按纯文本处理。
	 * 不拼 innerHTML，模型返回的尖括号不会被当成标签；落单的记号直接去掉，
	 * 免得星号出现在孩子眼前。表情符号是普通字符，照原样显示。
	 */
	fillKidText(doc, container, text) {
		var self = this;
		var src = String(text == null ? '' : text);
		src.split(/(\*\*[^*]+\*\*|==[^=]+==)/g).forEach(function (part) {
			if (!part) {
				return;
			}
			var bold = part.match(/^\*\*([^*]+)\*\*$/);
			if (bold) {
				container.appendChild(self.el(doc, 'strong', 'ds-kid-b', bold[1]));
				return;
			}
			var em = part.match(/^==([^=]+)==$/);
			if (em) {
				container.appendChild(self.el(doc, 'span', 'ds-kid-em', em[1]));
				return;
			}
			container.appendChild(self.el(doc, 'span', null, part.replace(/\*\*|==/g, '')));
		});
		return container;
	},

	/**
	 * 词形字段不再显示（用户 2026-10-16 明确说没用）。
	 * 但 data.form.surface 还留着当高亮定位的兜底候选，所以提示词里仍然要这个字段。
	 */

	/** 按类型渲染结果主体。sourceText 是用户实际选中的文字，用来在原文里定位高亮；
	 *  count 是本书词次（service.js 查好的），没有就不显示。 */
	resultBody(doc, data, sourceText, count) {
		var box = this.el(doc, 'div', 'ds-result');
		if (!data || typeof data !== 'object') {
			box.appendChild(this.el(doc, 'div', 'ds-error', '返回内容无法解析。'));
			return box;
		}

		// 母语幼儿模式：只有词条和两到三段简单英文，不要别的区块
		if (Array.isArray(data.kidParagraphs) && data.kidParagraphs.length) {
			return this.kidBody(doc, data, count);
		}

		var type = data.type;
		if (type === 'sentence' || type === 'paragraph') {
			var transBox = this.el(doc, 'div', 'ds-block');
			transBox.appendChild(this.el(doc, 'div', 'ds-label', this.textLabel()));
			transBox.appendChild(this.el(doc, 'div', 'ds-translation', data.translation || '（没有返回译文）'));
			box.appendChild(transBox);
			return box;
		}

		if (type !== 'word' && type !== 'phrase') {
			// 模型没按模板给 type，退化成把已知字段都摆出来
			box.appendChild(this.el(doc, 'div', 'ds-translation', data.translation || ''));
			return box;
		}

		var headword = data.headword || data.phrase || '';
		if (headword) {
			var title = this.el(doc, 'div', 'ds-headword');
			title.appendChild(this.el(doc, 'span', 'ds-word', headword));
			if (data.pronunciation) {
				title.appendChild(this.el(doc, 'span', 'ds-pron', data.pronunciation));
			}
			// 本书词次，贴在词条那一行的最右侧
			if (count && count.count > 0) {
				title.appendChild(this.countBadge(doc, count));
			}
			box.appendChild(title);
		}

		// 通用释义。排在语境义之前，和提示词里的输出顺序一致
		var senses = (Array.isArray(data.senses) ? data.senses : []).filter(function (sense) {
			return sense && (sense.pos || sense.meaning || sense.register);
		});
		if (senses.length) {
			var senseBox = this.el(doc, 'div', 'ds-block');
			senseBox.appendChild(this.el(doc, 'div', 'ds-label', '通用释义'));
			var list = this.el(doc, 'ul', 'ds-senses');
			senses.forEach(function (sense) {
				var li = doc.createElementNS('http://www.w3.org/1999/xhtml', 'li');
				if (sense.pos) {
					li.appendChild(DeepSeekTranslate.render.el(doc, 'span', 'ds-pos', sense.pos));
				}
				if (sense.meaning) {
					li.appendChild(DeepSeekTranslate.render.el(doc, 'span', 'ds-mean', sense.meaning));
				}
				if (sense.register) {
					li.appendChild(DeepSeekTranslate.render.el(doc, 'span', 'ds-reg', sense.register));
				}
				list.appendChild(li);
			});
			senseBox.appendChild(list);
			box.appendChild(senseBox);
		}

		// 语境义单独成块，这是这个插件存在的理由。
		// 两行：先给带词性的简短释义，再给「文中指……」一句话。
		var inContext = data.inContext;
		var ctxObject = inContext && typeof inContext === 'object' ? inContext : null;
		var ctxGloss = (ctxObject && ctxObject.gloss) || '';
		var ctxNote = (ctxObject && ctxObject.note) || '';
		var legacyMeaning = typeof inContext === 'string'
			? inContext
			: ((ctxObject && ctxObject.meaning) || '');
		if (!ctxGloss && legacyMeaning) {
			// 旧格式只有 meaning 一个字段，直接当简短释义显示
			ctxGloss = legacyMeaning;
		}
		if (ctxGloss || ctxNote) {
			var ctx = this.el(doc, 'div', 'ds-context-meaning');
			ctx.appendChild(this.el(doc, 'div', 'ds-label', '在本句中的含义'));
			if (ctxGloss) {
				ctx.appendChild(this.el(doc, 'div', 'ds-ctx-gloss', ctxGloss));
			}
			if (ctxNote) {
				ctx.appendChild(this.el(doc, 'div', 'ds-ctx-text', ctxNote));
			}
			box.appendChild(ctx);
		}

		/* 原句与译文。高亮的定位放在本地：原文用用户实际选中的文字，
		 * 译文用模型给出的对应译词。找不到就不高亮——宁可没有，也不能标错位置。 */
		if (ctxObject) {
			var sentence = this.stripMarkers(ctxObject.sentence);
			if (sentence) {
				var sentenceLine = this.el(doc, 'div', 'ds-sentence');
				// 选中文字是第一选择；模型抄的句子有可能把词换了形态，再拿表层形式和词元兜一次
				this.highlightText(doc, sentenceLine, sentence, [
					sourceText,
					data.form && data.form.surface,
					data.headword,
					data.phrase,
				]);
				box.appendChild(this.labelled(doc, '原句', sentenceLine));
			}
			var translation = this.stripMarkers(ctxObject.sentenceTranslation);
			if (translation) {
				var transLine = this.el(doc, 'div', 'ds-sentence');
				this.highlightText(
					doc,
					transLine,
					translation,
					this.termCandidates(ctxObject.targetTerm),
					this.glossCandidates(ctxObject.gloss)
				);
				box.appendChild(this.labelled(doc, this.textLabel(), transLine));
			}
		}

		if (data.usage) {
			box.appendChild(this.section(doc, '用法', data.usage));
		}

		// 例句只有一组：第一条体现本文语境，其余是通用例句，界面上不分开说明
		var exampleList = (Array.isArray(data.examples) && data.examples.length)
			? data.examples
			: data.generalExamples;
		var examplesBlock = this.examplesBlock(doc, '例句', exampleList);
		if (examplesBlock) {
			box.appendChild(examplesBlock);
		}

		if (data.explanation) {
			box.appendChild(this.section(doc, '讲解', data.explanation));
		}
		// 词源排在讲解之后
		if (data.etymology) {
			box.appendChild(this.section(doc, '词源', data.etymology));
		}

		return box;
	},

	/** 带标签的容器，标签下面放一个现成的节点 */
	labelled(doc, label, node) {
		var box = this.el(doc, 'div', 'ds-block');
		box.appendChild(this.el(doc, 'div', 'ds-label', label));
		box.appendChild(node);
		return box;
	},

	/**
	 * 把 text 里 needle 那一处渲染成高亮，其余按纯文本处理。
	 * needle 可以给一串候选，按顺序试，第一个能定位到的胜出。
	 * narrowCandidates 是「更短的说法」：定位到之后如果它们出现在这个范围里，就收窄到它。
	 * 定位全在本地做：模型只负责给出「对应译词」，位置由我们按字面找。
	 * 不拼 innerHTML，模型返回的内容里出现尖括号也不会被当成标签。
	 */
	highlightText(doc, container, text, needle, narrowCandidates) {
		var t = String(text == null ? '' : text);
		var span = this.findSpanAny(t, needle);
		if (span && narrowCandidates && narrowCandidates.length) {
			span = this.narrowSpan(t, span, narrowCandidates) || span;
		}
		if (!span) {
			container.appendChild(this.el(doc, 'span', null, t));
			return container;
		}
		if (span.start > 0) {
			container.appendChild(this.el(doc, 'span', null, t.slice(0, span.start)));
		}
		container.appendChild(this.el(doc, 'span', 'ds-hl', t.slice(span.start, span.end)));
		if (span.end < t.length) {
			container.appendChild(this.el(doc, 'span', null, t.slice(span.end)));
		}
		return container;
	},

	/**
	 * 在已经定位到的范围里再收窄一次。
	 * 模型常把邻近词的译法一起圈进来（选 conventions、译文「音乐惯例的改变」，
	 * 它给的是「音乐惯例」），而 gloss 里的短释义通常就是「惯例」。
	 * 只在原范围内部找，不会跳到译文里别的地方去。
	 */
	narrowSpan(text, span, candidates) {
		var t = String(text == null ? '' : text);
		var inner = t.slice(span.start, span.end);
		var list = Array.isArray(candidates) ? candidates : [candidates];
		var best = null;
		for (var i = 0; i < list.length; i++) {
			var needle = String(list[i] == null ? '' : list[i]);
			if (!needle) {
				continue;
			}
			var at = inner.indexOf(needle);
			if (at < 0) {
				continue;
			}
			var start = span.start + at;
			var end = start + needle.length;
			if (!best || (end - start) > (best.end - best.start)) {
				best = { start: start, end: end };
			}
		}
		return best;
	},

	/** 从带词性的简短释义里抽出中文片段，用作收窄候选（n. 惯例；习俗 → 惯例、习俗） */
	glossCandidates(gloss) {
		var runs = this.stripMarkers(gloss).match(/[\u3400-\u9fff]{2,}/g) || [];
		var out = [];
		runs.forEach(function (run) {
			if (out.indexOf(run) < 0) {
				out.push(run);
			}
		});
		return out;
	},

	/** 候选词逐个试，返回第一个能定位到的区间 */
	findSpanAny(text, needles) {
		var list = Array.isArray(needles) ? needles : [needles];
		for (var i = 0; i < list.length; i++) {
			var span = this.findSpan(text, list[i]);
			if (span) {
				return span;
			}
		}
		return null;
	},

	/** 译词的候选：先原样，再去掉括号补充（推子（fader）这种），最后取第一段 */
	termCandidates(term) {
		var raw = this.stripMarkers(term).trim();
		if (!raw) {
			return [];
		}
		var out = [raw];
		var noParens = raw.replace(/[（(【\[「『][^）)】\]」』]*[）)】\]」』]/g, '').trim();
		if (noParens && noParens !== raw) {
			out.push(noParens);
		}
		var head = raw.split(/[\s、，,；;：:·—–-]+/).filter(Boolean)[0];
		if (head && out.indexOf(head) < 0) {
			out.push(head);
		}
		return out;
	},

	/**
	 * 归一化易变字符，并记下每个字符在原串里的下标。
	 * 空白和标点全部丢掉——PDF 文字层会在汉字之间插空格，模型抄句子时也可能把逗号、
	 * 连字符改成别的写法，只留字母、数字和汉字反而最容易对上。
	 */
	normalizeForMatch(text) {
		var chars = [];
		var map = [];
		var s = String(text == null ? '' : text);
		var skip = /[\s.,;:!?'"`“”‘’()\[\]{}<>«»…·、，。；：！？（）【】「」『』—–\-_/\\|@#$%^&*+=~]/;
		for (var i = 0; i < s.length; i++) {
			var ch = s[i];
			if (skip.test(ch)) {
				continue;
			}
			chars.push(ch.toLowerCase());
			map.push(i);
		}
		return { text: chars.join(''), map: map };
	},

	/**
	 * 在 text 里定位 needle。
	 *
	 * 优先取「独立成词」的那一处：选中 a 这种单字母时，直接 indexOf 会先命中
	 * Chant 里的那个 a，高亮就画到半个词上去了。所以先找前后都不是字母数字的匹配，
	 * 找不到才退到第一次出现（用户可能只选了某个词的前半截，那种情况只能按位置来）。
	 * 最后再退到忽略空白与标点差异的比对（应对 PDF 插空格、标点被改写）。
	 */
	findSpan(text, needle) {
		var t = String(text == null ? '' : text);
		var n = String(needle == null ? '' : needle).trim();
		if (!t || !n) {
			return null;
		}
		var span = this._standaloneSpan(t, n)
			|| this._standaloneSpan(t.toLowerCase(), n.toLowerCase());
		if (span) {
			return span;
		}
		var at = t.indexOf(n);
		if (at < 0) {
			at = t.toLowerCase().indexOf(n.toLowerCase());
		}
		if (at >= 0) {
			return { start: at, end: at + n.length };
		}
		var hay = this.normalizeForMatch(t);
		var pin = this.normalizeForMatch(n);
		if (!pin.text.length) {
			return null;
		}
		var hit = hay.text.indexOf(pin.text);
		if (hit < 0) {
			return null;
		}
		return {
			start: hay.map[hit],
			end: hay.map[hit + pin.text.length - 1] + 1,
		};
	},

	/** 第一处「前后都不是字母数字」的匹配，用于避开单词内部 */
	_standaloneSpan(hay, needle) {
		if (!hay || !needle) {
			return null;
		}
		var at = hay.indexOf(needle);
		while (at >= 0) {
			var before = at > 0 ? hay.charAt(at - 1) : '';
			var after = at + needle.length < hay.length ? hay.charAt(at + needle.length) : '';
			if (!this._isWordChar(before) && !this._isWordChar(after)) {
				return { start: at, end: at + needle.length };
			}
			at = hay.indexOf(needle, at + 1);
		}
		return null;
	},

	/** 字母、数字、汉字都算词内字符：前后挨着它们说明没落在词边界上 */
	_isWordChar(ch) {
		return !!ch && /[0-9A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/.test(ch);
	},

	/** 去掉可能残留的 ** 标记（旧版提示词让模型加过，历史记录里可能还有） */
	stripMarkers(text) {
		return String(text == null ? '' : text).replace(/\*\*/g, '');
	},

	/** 例句列表。没有可用例句时返回 null，调用方要先判空 */
	examplesBlock(doc, label, list) {
		var usable = (Array.isArray(list) ? list : []).filter(function (ex) {
			return ex && (ex.source || ex.translation);
		});
		if (!usable.length) {
			return null;
		}
		var exBox = this.el(doc, 'div', 'ds-block');
		exBox.appendChild(this.el(doc, 'div', 'ds-label', label));
		var exList = this.el(doc, 'ul', 'ds-examples');
		usable.forEach(function (ex) {
			var li = doc.createElementNS('http://www.w3.org/1999/xhtml', 'li');
			if (ex.source) {
				li.appendChild(DeepSeekTranslate.render.el(doc, 'div', 'ds-ex-source', ex.source));
			}
			if (ex.translation) {
				li.appendChild(DeepSeekTranslate.render.el(doc, 'div', 'ds-ex-trans', ex.translation));
			}
			exList.appendChild(li);
		});
		exBox.appendChild(exList);
		return exBox;
	},

	section(doc, label, text) {
		var box = this.el(doc, 'div', 'ds-block');
		box.appendChild(this.el(doc, 'div', 'ds-label', label));
		box.appendChild(this.el(doc, 'div', 'ds-text', text));
		return box;
	},

	/** 复制到剪贴板用的纯文本 */
	copyText(entry) {
		if (entry.error) {
			return entry.text + '\n\n[翻译失败] ' + entry.error;
		}
		var data = entry.data || {};
		var lines = [];
		var type = DeepSeekTranslate.prompts.TYPE_LABEL[data.type] || '';

		// 母语幼儿模式：词条 + 分段解释，抄成笔记也够用
		if (Array.isArray(data.kidParagraphs) && data.kidParagraphs.length) {
			lines.push((data.headword || entry.text || '') +
				(data.pronunciation ? ' ' + data.pronunciation : ''));
			data.kidParagraphs.forEach(function (text) {
				lines.push('');
				lines.push(String(text || ''));
			});
			return lines.join('\n');
		}

		if (data.type === 'sentence' || data.type === 'paragraph') {
			lines.push(entry.text);
			lines.push('');
			lines.push(data.translation || '');
			return lines.join('\n');
		}

		lines.push((data.headword || data.phrase || entry.text) + (data.pronunciation ? ' ' + data.pronunciation : ''));
		if (type) {
			lines.push('[' + type + ']');
		}
		lines.push('');
		lines.push('通用释义：');
		(Array.isArray(data.senses) ? data.senses : []).forEach(function (s) {
			var parts = [];
			if (s && s.pos) {
				parts.push(s.pos);
			}
			if (s && s.meaning) {
				parts.push(s.meaning);
			}
			if (s && s.register) {
				parts.push('（' + s.register + '）');
			}
			if (parts.length) {
				lines.push('- ' + parts.join(' '));
			}
		});
		var inContext = data.inContext;
		if (inContext) {
			var ctxObject = typeof inContext === 'object' ? inContext : null;
			var ctxGloss = (ctxObject && ctxObject.gloss)
				|| (typeof inContext === 'string' ? inContext : ((ctxObject && ctxObject.meaning) || ''));
			var ctxNote = (ctxObject && ctxObject.note) || '';
			if (ctxGloss || ctxNote) {
				lines.push('');
				lines.push('在本句中的含义：');
				if (ctxGloss) {
					lines.push(ctxGloss);
				}
				if (ctxNote) {
					lines.push(ctxNote);
				}
			}
			if (ctxObject) {
				if (ctxObject.sentence) {
					lines.push('');
					lines.push('原句：' + this.stripMarkers(ctxObject.sentence));
				}
				if (ctxObject.sentenceTranslation) {
					lines.push('译文：' + this.stripMarkers(ctxObject.sentenceTranslation));
				}
			}
		}
		if (data.usage) {
			lines.push('');
			lines.push('用法：' + data.usage);
		}
		var exampleList = (Array.isArray(data.examples) && data.examples.length)
			? data.examples
			: data.generalExamples;
		var exampleItems = (Array.isArray(exampleList) ? exampleList : []).filter(function (ex) {
			return ex && (ex.source || ex.translation);
		});
		if (exampleItems.length) {
			lines.push('');
			lines.push('例句：');
			exampleItems.forEach(function (ex) {
				lines.push('- ' + (ex.source || ''));
				if (ex.translation) {
					lines.push('  ' + ex.translation);
				}
			});
		}
		if (data.explanation) {
			lines.push('');
			lines.push('讲解：' + data.explanation);
		}
		// 词源排在讲解之后，和面板里的顺序一致
		if (data.etymology) {
			lines.push('');
			lines.push('词源：' + data.etymology);
		}
		return lines.join('\n');
	},
};
