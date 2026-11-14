/* 词形归并（lemmatization）。
 *
 * 目标：把同一个词的屈折变化合并成一条。dog / dogs 合成 dog，
 * am / is / are / was / were 合成 be，walk / walks / walked / walking 合成 walk。
 *
 * 只做屈折变化，不做派生。happiness 不并进 happy，national 不并进 nation——
 * 那是另一个词，并了会掩盖信息。
 *
 * 三条路一起用：
 *   1. 不规则表：am→be、went→go、children→child。规则推不出来的都在这里。
 *   2. 后缀规则：-s / -es / -ies / -ed / -ing，带一份「长这样但不是屈折变化」的禁剥表
 *      （news、physics、during、building? 不，building 要并进 build）。
 *   3. 文档词汇表：同一份文献里的其它词形。用来在多个候选之间挑，
 *      比如 used 到底归 us 还是 use——文献里要是出现过 use，就选 use。
 *
 * 这个模块是纯函数，不碰 Zotero，能离线测。
 */

var WordFreq = WordFreq || {};

WordFreq.lemma = (function () {
	// ── 词形 → 原形。先查这张表，命中就不走规则了 ──────────
	var IRREGULAR = Object.create(null);

	function addIrregular(base, forms) {
		var list = String(forms).split(/\s+/);
		for (var i = 0; i < list.length; i++) {
			var f = list[i];
			// 先写进去的优先，所以下面的登记顺序有意义
			if (f && f !== base && !IRREGULAR[f]) {
				IRREGULAR[f] = base;
			}
		}
	}

	// 动词：原形 后面跟它的其它形式。
	// 顺序上动词先登记，动词表里没有的才轮到名词表。
	var VERB_FORMS = {
		be: 'am is are was were been being',
		have: 'has had having',
		do: 'does did done doing',
		say: 'says said saying',
		go: 'goes went gone going',
		get: 'gets got gotten getting',
		make: 'makes made making',
		know: 'knows knew known knowing',
		think: 'thinks thought thinking',
		take: 'takes took taken taking',
		see: 'sees saw seen seeing',
		come: 'comes came coming',
		give: 'gives gave given giving',
		find: 'finds found finding',
		tell: 'tells told telling',
		become: 'becomes became becoming',
		leave: 'leaves left leaving',
		feel: 'feels felt feeling',
		put: 'puts putting',
		bring: 'brings brought bringing',
		begin: 'begins began begun beginning',
		keep: 'keeps kept keeping',
		hold: 'holds held holding',
		write: 'writes wrote written writing',
		stand: 'stands stood standing',
		hear: 'hears heard hearing',
		let: 'lets letting',
		mean: 'means meant meaning',
		set: 'sets setting',
		meet: 'meets met meeting',
		run: 'runs ran running',
		pay: 'pays paid paying',
		sit: 'sits sat sitting',
		speak: 'speaks spoke spoken speaking',
		lie: 'lies lain lying',
		lead: 'leads led leading',
		read: 'reads reading',
		grow: 'grows grew grown growing',
		lose: 'loses lost losing',
		fall: 'falls fell fallen falling',
		send: 'sends sent sending',
		build: 'builds built building',
		understand: 'understands understood understanding',
		draw: 'draws drew drawn drawing',
		break: 'breaks broke broken breaking',
		spend: 'spends spent spending',
		cut: 'cuts cutting',
		rise: 'rises rose risen rising',
		drive: 'drives drove driven driving',
		buy: 'buys bought buying',
		wear: 'wears wore worn wearing',
		choose: 'chooses chose chosen choosing',
		eat: 'eats ate eaten eating',
		win: 'wins won winning',
		teach: 'teaches taught teaching',
		catch: 'catches caught catching',
		fight: 'fights fought fighting',
		seek: 'seeks sought seeking',
		throw: 'throws threw thrown throwing',
		fly: 'flies flew flown flying',
		forget: 'forgets forgot forgotten forgetting',
		hide: 'hides hid hidden hiding',
		shake: 'shakes shook shaken shaking',
		sing: 'sings sang sung singing',
		swim: 'swims swam swum swimming',
		ring: 'rings rang rung ringing',
		drink: 'drinks drank drunk drinking',
		sink: 'sinks sank sunk sinking',
		spring: 'springs sprang sprung springing',
		steal: 'steals stole stolen stealing',
		freeze: 'freezes froze frozen freezing',
		sleep: 'sleeps slept sleeping',
		sweep: 'sweeps swept sweeping',
		weep: 'weeps wept weeping',
		creep: 'creeps crept creeping',
		deal: 'deals dealt dealing',
		dig: 'digs dug digging',
		hang: 'hangs hung hanging',
		strike: 'strikes struck striking',
		stick: 'sticks stuck sticking',
		spin: 'spins spun spinning',
		shoot: 'shoots shot shooting',
		feed: 'feeds fed feeding',
		flee: 'flees fled fleeing',
		bleed: 'bleeds bled bleeding',
		breed: 'breeds bred breeding',
		speed: 'speeds sped speeding',
		slide: 'slides slid sliding',
		bite: 'bites bit bitten biting',
		beat: 'beats beaten beating',
		bear: 'bears bore borne bearing',
		tear: 'tears tore torn tearing',
		wake: 'wakes woke woken waking',
		shut: 'shuts shutting',
		spread: 'spreads spreading',
		split: 'splits splitting',
		spit: 'spits spat spitting',
		burst: 'bursts bursting',
		forbid: 'forbids forbade forbidden forbidding',
		forgive: 'forgives forgave forgiven forgiving',
		arise: 'arises arose arisen arising',
		bind: 'binds bound binding',
		blow: 'blows blew blown blowing',
		cling: 'clings clung clinging',
		grind: 'grinds ground grinding',
		lay: 'lays laid laying',
		lend: 'lends lent lending',
		mistake: 'mistakes mistook mistaken mistaking',
		overcome: 'overcomes overcame overcoming',
		prove: 'proves proven proving',
		shine: 'shines shone shining',
		shrink: 'shrinks shrank shrunk shrinking',
		sting: 'stings stung stinging',
		stink: 'stinks stank stunk stinking',
		swear: 'swears swore sworn swearing',
		swell: 'swells swollen swelling',
		tread: 'treads trod trodden treading',
		undergo: 'undergoes underwent undergone undergoing',
		undertake: 'undertakes undertook undertaken undertaking',
		weave: 'weaves wove woven weaving',
		withdraw: 'withdraws withdrew withdrawn withdrawing',
		wind: 'winds wound winding',
		// 缩写形式按原形归并
		can: "can't cannot could couldn't",
		will: "will won't would wouldn't",
		shall: "shall shouldn't should",
		must: "must mustn't",
		may: 'may might',
	};

	for (var verbBase in VERB_FORMS) {
		addIrregular(verbBase, VERB_FORMS[verbBase]);
	}

	// 名词：不规则复数。动词表里已经登记过的词形不会被覆盖，
	// 所以 leaves 归 leave（动词），不是 leaf。
	var NOUN_FORMS = {
		child: 'children',
		man: 'men',
		woman: 'women',
		person: 'people persons',
		mouse: 'mice',
		foot: 'feet',
		tooth: 'teeth',
		goose: 'geese',
		ox: 'oxen',
		louse: 'lice',
		analysis: 'analyses',
		basis: 'bases',
		crisis: 'crises',
		thesis: 'theses',
		hypothesis: 'hypotheses',
		synthesis: 'syntheses',
		emphasis: 'emphases',
		diagnosis: 'diagnoses',
		parenthesis: 'parentheses',
		axis: 'axes',
		appendix: 'appendices',
		index: 'indices indexes',
		matrix: 'matrices',
		vertex: 'vertices',
		apparatus: 'apparatuses',
		criterion: 'criteria',
		phenomenon: 'phenomena',
		automaton: 'automata',
		stimulus: 'stimuli',
		radius: 'radii',
		nucleus: 'nuclei',
		fungus: 'fungi',
		cactus: 'cacti',
		syllabus: 'syllabi',
		alumnus: 'alumni',
		larva: 'larvae',
		formula: 'formulae formulas',
		vertebra: 'vertebrae',
		corpus: 'corpora',
		genus: 'genera',
		spectrum: 'spectra',
		curriculum: 'curricula',
		bacterium: 'bacteria',
		memorandum: 'memoranda',
		stratum: 'strata',
		addendum: 'addenda',
		erratum: 'errata',
		// 拼写不能靠规则推的
		knife: 'knives',
		wife: 'wives',
		wolf: 'wolves',
		shelf: 'shelves',
		half: 'halves',
		calf: 'calves',
		loaf: 'loaves',
		thief: 'thieves',
		self: 'selves',
		elf: 'elves',
		scarf: 'scarves',
		hoof: 'hooves',
		dwarf: 'dwarves',
		// 比较级与最高级：只并原形没有歧义的那几个。
		// more/most 同时是 much 和 many 的，less/least 同时是 little 的，
		// further 在学术文本里常当「进而」用，这些都不并。
		good: 'better best',
		bad: 'worse worst',
		underlie: 'underlies underlay underlain underlying',
		belie: 'belies belied belying',
	};

	for (var nounBase in NOUN_FORMS) {
		addIrregular(nounBase, NOUN_FORMS[nounBase]);
	}

	// 缩写形式。词里带撇号，后缀规则动不了它们，只能查表。
	// 不处理的话，高频词列表里会冒出 you're、you'll、don't 这些。
	var CONTRACTIONS = {
		do: "don't doesn't didn't",
		be: "isn't aren't wasn't weren't ain't",
		have: "hasn't haven't hadn't",
		i: "i'm i'll i've i'd",
		you: "you're you'll you've you'd",
		we: "we're we'll we've we'd",
		they: "they're they'll they've they'd",
		he: "he's he'll he'd",
		she: "she's she'll she'd",
		it: "it's it'll it'd",
		that: "that's that'll",
		there: "there's there'll",
		here: "here's",
		who: "who's who'll",
		what: "what's",
		let: "let's",
	};

	for (var cBase in CONTRACTIONS) {
		addIrregular(cBase, CONTRACTIONS[cBase]);
	}

	// 手工裁决：同一词形对应两个原形时选哪个。写在最后，覆盖上面的登记。
	var OVERRIDES = {
		bases: 'base',        // basis 的复数也是 bases，学术文本里 base 更常见
		axes: 'axis',
		leaves: 'leave',      // 也是 leaf 的复数，这里归动词
		lives: 'live',        // 也是 life 的复数，这里归动词
		found: 'find',        // 也是动词 found 的原形
		lay: 'lay',           // 是 lie 的过去式，但本身也是常用动词，不并
		left: 'leave',        // 也是方位词 left
		lying: 'lie',
	};
	for (var ov in OVERRIDES) {
		IRREGULAR[ov] = OVERRIDES[ov];
	}

	// ── 以 -s / -ed / -ing 结尾、但不是屈折变化的词，禁止剥后缀 ──
	// 这些剥了会变成不是一个词的字符串，或者把单数当复数。
	var NOT_INFLECTED = new Set(
		('this his its was has does goes is as us yes plus bus gas news series species means ' +
			'always perhaps across unless nonetheless nevertheless whereas towards upwards ' +
			'downwards forwards backwards sometimes anyway anyways towards towards ' +
			'physics mathematics statistics economics politics ethics linguistics athletics ' +
			'gymnastics acoustics dynamics optics mechanics electronics genetics aesthetics ' +
			'logistics robotics semantics phonetics graphics ' +
			'class glass grass mass pass press process access success address business witness ' +
			'illness darkness kindness consciousness happiness weakness thickness ' +
			'apparatus status campus virus census focus bonus surplus minus ' +
			'analysis basis crisis thesis axis emphasis synthesis hypothesis diagnosis ' +
			'parenthesis ' +
			'during nothing something anything everything thing king ring bring spring string ' +
			'sing wing swing sting cling fling sling wring morning evening ceiling offspring ' +
			'according regarding concerning existing missing interesting ' +
			'shed sled bed red fed wed led fled seed need weed breed speed feed deed indeed reed ' +
			'trans unexpected groundbreaking unlimited unpaginated ' +
			'forthcoming hardwired impassioned kindred ongoing painstaking shortsighted ' +
			'cunning creed welldefined filmmaking disembodied renowned preexisting ' +
			'myself yourself himself herself itself oneself ourselves yourselves themselves ' +
			'hundred sacred naked wicked ' +
			'technics cybernetics').split(/\s+/)
	);

	// ── 已知的常见原形 ──
	// 用来在 -ed / -ing 的多个候选之间裁决：liked 归 like 而不是 lik，
	// using 归 use 而不是 us，pulled 归 pull 而不是 pul。
	// 里面以 -e 结尾的动词占多数（规则推不出它们），也收了一批
	// 双写辅音的动词（stop/pull/buzz/compel）。
	// 不收这张表就只能靠文档词汇表猜，猜错时切出来的是 pul、invok 这种非词。
	var KNOWN_BASES = new Set(
		('use like move create make include provide produce require cause change receive ' +
			'believe achieve determine describe increase decrease measure note base involve ' +
			'relate define compare remove assume observe prepare examine imagine serve live ' +
			'love save give take come become write state rate estimate calculate evaluate ' +
			'analyse analyze organize recognise recognize realize realise minimise minimize ' +
			'maximise maximize cite derive divide combine continue decline define denote ' +
			'depict derive desire dispose distance distribute diverse dominate educate ' +
			'eliminate emerge emphasize emphasise employ enable encode encourage engage ' +
			'enhance ensure examine exceed exclude excuse execute exercise expand expect ' +
			'explore expose express extend face facilitate figure finance force frame ' +
			'generate guide handle hope identify ignore illustrate imply improve incorporate ' +
			'indicate influence inform initiate innovate inquire inspire install integrate ' +
			'introduce investigate involve isolate issue judge justify locate maintain ' +
			'manage manufacture mention name notice obtain occur organise organize ' +
			'participate perceive perform permit persuade place please pose practice ' +
			'practise precede prefer preserve propose protect purchase pursue qualify ' +
			'question raise range realise realize receive recognise recognize reduce refer ' +
			'reflect refuse regard regulate reject release rely remain remember replace ' +
			'represent require rescue resolve respond restore result retire reveal reverse ' +
			'revise rise rule sample satisfy scale score secure seek select sense separate ' +
			'serve settle shape share shift shine sign simplify situate solve specify ' +
			'stimulate store strike structure struggle study succeed suffer suggest ' +
			'suppose surprise survive sustain terminate test tolerate trace transfer ' +
			'transform translate transport travel treat trigger trouble unite update ' +
			'upgrade validate value vary verify violate visualize vote waste watch wave ' +
			'welcome worry ' +
			// 第二批：审查真实语料时补的常见学术动词
			'tune notate conceptualize contextualize categorize characterize criticize ' +
			'customize demonstrate decode designate deteriorate differentiate displace ' +
			'dissolve distribute document dominate elaborate elevate encounter endorse ' +
			'enforce entertain enumerate erase escalate evacuate evaporate evolve exaggerate ' +
			'excavate exchange excite exemplify exhale exhibit experience experiment expire ' +
			'explain explode exploit expose express extend extract fabricate formulate ' +
			'frustrate generalize generate graduate guarantee hesitate house hypothesize ' +
			'illustrate imitate implement implicate impose impress improvise incorporate ' +
			'indicate induce infect infer inflate influence inform inherit inhibit ' +
			'initialize initiate inject innovate inquire insert insist inspect inspire ' +
			'install institute instruct insulate integrate intend interact interfere ' +
			'interpret intervene introduce invade invent investigate invite isolate itemize ' +
			'justify label legislate liberate license locate lodge maintain manipulate ' +
			'manufacture marginalize materialize memorize mention merge migrate mingle ' +
			'mobilize moderate modernize modify modulate monitor motivate multiply mutate ' +
			'narrate navigate negotiate normalize notify oblige obscure observe obstruct ' +
			'occupy offend operate oppose optimize orchestrate orient originate outline ' +
			'overcome overlap participate penetrate perceive perform permit perpetuate ' +
			'persuade personalize place please police pollute populate portray pose possess ' +
			'postpone practice praise precede predict prefer prescribe present preserve ' +
			'preside presume pretend prevail prevent procure produce profess prohibit ' +
			'prolong promise promote prompt pronounce propagate propose protect protest ' +
			'provide provoke publish punctuate purchase purify pursue qualify quantify ' +
			'quote radiate raise rationalize react realize rearrange reassure recall receive ' +
			'recite recognize recommend reconcile reconstruct recover recreate recruit ' +
			'recycle redefine redesign reduce refute regenerate register regret regulate ' +
			'rehearse reinforce reinstate reiterate reject relate relax release relieve ' +
			'relocate rely remain remark remedy remember remind remove rename render renew ' +
			'reorganize repair repay repeat replace replicate reply report represent ' +
			'reproduce request require rescue research resemble reserve reside resign resist ' +
			'resolve respect respond restore restrain restrict resume retain retire retrieve ' +
			'reveal reverse review revise revive rotate sacrifice salvage satisfy save scale ' +
			'scan scatter schedule scrutinize secure seduce seize select separate sequence ' +
			'serve settle shape share shelter shift shine shorten showcase shred signify ' +
			'simulate situate sketch slice slide smile specify speculate stabilize ' +
			'standardize stare state stimulate stipulate streamline strengthen stress ' +
			'stretch structure struggle study stumble subdivide submit subscribe substitute ' +
			'subtract succeed suffer suggest supervise supplement suppose surprise surround ' +
			'survey survive suspect sustain terminate test tolerate trace trade transfer ' +
			'transform translate transmit transport travel treat trigger trouble unite ' +
			'update activate synthesize theorize summarize prioritize utilize formalize ' +
			'symbolize specialize socialize privatize integrate argue entitle file handle ' +
			'enable disable assemble resemble ' +
			// 第三批：审查真实语料时还剩下的 -e 结尾动词
			'invoke devise acknowledge fascinate coincide denounce anticipate pronounce ' +
			'announce renounce deduce acquire admire advertise advise compose comprise ' +
			'compromise conceive confuse conserve consume contrive convince correlate ' +
			'delete deprive deserve disclose dispose dispute donate enclose endure enlarge ' +
			'enquire explore impose ' +
			// 第四批：审查长语料补的，外加双写辅音的动词
			'arrange incline vindicate cultivate intrigue attribute glide vibrate cobble ' +
			'buzz pull drill spare compel excel rebel propel expel repel dispel control ' +
			'patrol enrol fulfil instal signal model label travel cancel total level marvel ' +
			'quarrel counsel tunnel spiral rival impel ' +
			// 第五批：把三份语料里剩下的 -e 动词一次补全，
			// 外加常见 un- 动词（un- 的判定规则要用到这张表）
			'abbreviate accelerate accumulate accuse agglomerate alienate allude amalgamate ' +
			'annihilate antiquate appreciate arouse articulate assure attenuate attune ' +
			'baptize belie bifurcate calibrate captivate cascade catalogue catalyze ' +
			'celebrate challenge chronicle circulate circumscribe cleave code collaborate ' +
			'collide compensate compete complete complicate concede conclude condense ' +
			'consolidate constitute contemplate contribute convene converge converse ' +
			'coordinate counterpose cripple curate dare debase dedicate deindividuate ' +
			'delineate delve depersonalize deprivatize deride despise destabilize detune ' +
			'devastate devote dictate dilate dilute disagree dislike disintegrate disperse ' +
			'dissociate diverge duplicate dwindle die dye embattle embrace encapsulate ' +
			'encircle ensconce ensnare entice entrance envisage epitomize equilibrate ' +
			'estrange exacerbate exhilarate expunge extemporize externalize extrapolate ' +
			'fixate fledge fluctuate grace grapple grope grudge humanize illuminate ' +
			'immerse immigrate insinuate instrumentalize interleave intermingle internalize ' +
			'internationalize intertwine intone intoxicate jaundice jingle jumble juxtapose ' +
			'localize mechanize mediate militate misguide misuse monopolize muse objectivize ' +
			'occlude oscillate outdate outpace overemphasize oversize permeate persecute ' +
			'peruse plague poise politicize precompose proselytize pulsate rattle ' +
			'reciprocate reconceptualize reconstitute refine reimagine reinvigorate reissue ' +
			'relegate rephrase repurpose restate revere revile rewire rumble scramble ' +
			'sensitize shuffle smoke sophisticate spatialize splice stifle striate ' +
			'subjugate suffice suffocate superannuate superimpose surmise tame tantalize ' +
			'terrace tie title transfigure transmute transpose trickle underappreciate ' +
			'understate variegate venture wane whittle wobble wrestle ' +
			'unfold unleash unsettle unpack uncover unlock unmask unplug unravel unroll ' +
			'untie unveil unwind unspool untap unify unearth undress unload unmute ' +
			'culminate percolate exoticize probe fledge uprise').split(/\s+/)
	);

	// ── 规则后缀 ────────────────────────────────────────

	function isVowel(ch) {
		return 'aeiou'.indexOf(ch) >= 0;
	}

	/** 末尾双写辅音去掉一个：stopp → stop */
	function undouble(w) {
		var n = w.length;
		if (n >= 3 && w[n - 1] === w[n - 2] && !isVowel(w[n - 1]) && w[n - 1] !== 's') {
			return w.slice(0, -1);
		}
		return null;
	}

	/**
	 * 名词复数 / 动词第三人称单数。
	 * @returns {string|null}
	 */
	function stripS(w, vocab) {
		var n = w.length;
		if (n < 4 || w[n - 1] !== 's') {
			return null;
		}

		// -ies：studies → study，但 movies → movie（先看文档里有没有 movies 的单数形态）
		if (n >= 5 && /ies$/.test(w)) {
			var withoutS = w.slice(0, -1);            // movies → movie
			if (vocab.has(withoutS)) {
				return withoutS;
			}
			return w.slice(0, -3) + 'y';              // studies → study
		}

		// -sses / -xes / -zes / -ches / -shes：剥 es
		if (/(?:ss|x|z|ch|sh)es$/.test(w)) {
			return w.slice(0, -2);
		}

		// -ses（单个 s）：roses → rose，cases → case，classes 已在上面处理掉
		if (/ses$/.test(w)) {
			return w.slice(0, -1);
		}

		// -oes：potatoes → potato，但 shoes → shoe
		if (/oes$/.test(w)) {
			var oWithoutS = w.slice(0, -1);
			if (vocab.has(oWithoutS)) {
				return oWithoutS;
			}
			return w.slice(0, -2);
		}

		// 剩下的 -s。ss/us/is/as/os 结尾的不动（那是词干本身的样子）
		if (/(?:ss|us|is|as|os)$/.test(w)) {
			return null;
		}
		return w.slice(0, -1);
	}

	/**
	 * 在 -ed / -ing 的候选之间挑一个原形。
	 *
	 * 三个候选：
	 *   bare   直接削掉后缀：walked → walk，stopped → stopp，pulled → pull
	 *   withE  bare 末尾补个 e：liked → like，using → use，invoked → invoke
	 *   single bare 末尾是双写辅音时去掉一个：stopped → stop，running → run
	 *
	 * 判据的优先级：文档里出现过 > 已知原形表 > 以 e 结尾的形态 > 双写还原。
	 * 最后一道要小心：ll / ss / ff / zz 本身就是合法的英文词尾，
	 * pull、buzz、class 去掉一个字母就变成非词，所以这几种不吃双写还原。
	 */
	function pickStem(bare, withE, single, vocab) {
		if (vocab.has(bare) || KNOWN_BASES.has(bare)) {
			return bare;
		}
		if (single && (vocab.has(single) || KNOWN_BASES.has(single))) {
			return single;
		}
		if (KNOWN_BASES.has(withE)) {
			return withE;
		}
		if (vocab.has(withE) && !vocab.has(bare)) {
			return withE;
		}
		if (vocab.has(bare) && !vocab.has(withE)) {
			return bare;
		}
		if (vocab.has(withE) && vocab.has(bare)) {
			// 两个都出现过：withE 更长，是原形的可能性更大（used → use 而不是 us）
			return withE;
		}
		if (single) {
			return /(?:ll|ss|ff|zz)$/.test(bare) ? bare : single;
		}
		return bare;
	}

	/**
	 * 过去式 / 过去分词。
	 * @returns {string|null}
	 */
	function stripEd(w, vocab) {
		var n = w.length;
		if (n < 4 || !/ed$/.test(w)) {
			return null;
		}

		// -ied：studied → study
		if (n >= 5 && /ied$/.test(w)) {
			return w.slice(0, -3) + 'y';
		}

		var bare = w.slice(0, -2);          // walked → walk，stopped → stopp
		var withE = w.slice(0, -1);         // liked → like，used → use
		return pickStem(bare, withE, undouble(bare), vocab);
	}

	/**
	 * 现在分词 / 动名词。
	 * @returns {string|null}
	 */
	function stripIng(w, vocab) {
		var n = w.length;
		if (n < 5 || !/ing$/.test(w)) {
			return null;
		}

		var bare = w.slice(0, -3);          // walking → walk，making → mak，running → runn
		return pickStem(bare, bare + 'e', undouble(bare), vocab);
	}

	/** 去掉所有格与缩写里的 's：dog's → dog，it's → it */
	function stripPossessive(w) {
		if (w.length > 2 && /'s$/.test(w)) {
			return w.slice(0, -2);
		}
		if (w.length > 1 && /'$/.test(w)) {
			return w.slice(0, -1);
		}
		return null;
	}

	/**
	 * 取一个词形的原形。
	 *
	 * @param {string} word 已经小写的词
	 * @param {Set<string>} [vocab] 同一份文献里出现过的全部小写词形，用于裁决歧义
	 * @param {object} [opts]
	 *   possessive  是否合并所有格，默认 true
	 *   capitalized 只以大写出现过的词（专有名词），这些不做规则剥后缀
	 * @returns {string}
	 */
	function of(word, vocab, opts) {
		opts = opts || {};
		if (!word) {
			return word;
		}
		vocab = vocab || EMPTY_SET;

		var w = word;
		if (opts.possessive !== false) {
			var stripped = stripPossessive(w);
			if (stripped && stripped.length >= 2) {
				w = stripped;
			}
		}

		if (IRREGULAR[w]) {
			return IRREGULAR[w];
		}

		// 专有名词不剥后缀。Sachs / Gilles / Charles / Rehding 这类词
		// 在正文里只以大写出现过，剥了会得到 sach / gille / charle。
		// 不规则表放在这条前面，免得句首大写的 Men 被漏掉。
		if (opts.capitalized && opts.capitalized.has(w)) {
			return w;
		}

		if (NOT_INFLECTED.has(w)) {
			return w;
		}

		// un- 开头的 -ed / -ing 词，绝大多数是「否定前缀 + 过去分词」构成的形容词：
		// unchanged、unnoticed、unprocessed、unprecedented。把后缀剥掉会切出
		// unchang、unnotic 这种非词。只有整词本来就是动词（unfold、unleash）
		// 才按规则处理，这些收在 KNOWN_BASES 里。
		if (/^un[a-z]/.test(w) && /(?:ed|ing)$/.test(w)) {
			var unBare = /ing$/.test(w) ? w.slice(0, -3) : w.slice(0, -2);
			if (!KNOWN_BASES.has(unBare)) {
				return w;
			}
		}

		var cand = stripS(w, vocab) || stripEd(w, vocab) || stripIng(w, vocab);
		if (cand && cand.length >= 2) {
			return cand;
		}
		return w;
	}

	var EMPTY_SET = new Set();

	return {
		of: of,
		IRREGULAR: IRREGULAR,
		NOT_INFLECTED: NOT_INFLECTED,
		E_VERBS: KNOWN_BASES,
		KNOWN_BASES: KNOWN_BASES,
	};
})();
