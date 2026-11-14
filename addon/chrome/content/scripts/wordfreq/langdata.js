/* 语言判定用的功能词表。
 *
 * 这些表有两个用途：
 *   1. 判定文献是不是英文——统计样本里命中各语言功能词的比例；
 *   2. 英语表兼作「过滤停用词」选项的词表。
 *
 * 写表的几条约定：
 *   - 表里一律写去掉变音符的 ASCII 形态。判定用的切词会先把变音符折掉
 *     （für→fur、après→apres、más→mas），两边对齐后就不用为每种语言
 *     分别列带符号的写法，也顺带抹平 PDF 提取时变音符时有时无的问题。
 *   - 全部小写，且是切词后的形态。判定用的切词按 [a-z]+ 切，撇号和连字符都断开，
 *     所以法语 l'homme 会切成 l 与 homme，表里要收 l 这种单字母。
 *   - 只收虚词。实词（名词、动词）各语言差异大，且会把两种语言混淆。
 *   - 两种语言都高频的词（a、in、on、me）留在英语表里，靠相对门槛区分。
 */

var WordFreq = WordFreq || {};

WordFreq.langdata = {
	// 英语最高频的虚词。在自然英语文本里能覆盖 35% 上下的 token。
	en: ('the of and to in a is that for it as was with be by on not this are or his ' +
		'from at which but have an had they you were their one all we can her has there ' +
		'been if more when will would who so no she its about than into them could other ' +
		'these may then some him out what up such do two only over also our most after ' +
		'because between under both during before through how each where those very same ' +
		'own just should now any many being until while again against upon within without ' +
		'whether however therefore thus although since among often must might does did my ' +
		'me your he i').split(/\s+/),

	fr: ('le la les des de du un une et en est que qui dans pour il elle pas sur ce cette ' +
		'ces avec ne se plus par comme mais ou son sa ses au aux nous vous ils elles sont ' +
		'etre avoir ont donc si leur leurs entre aussi deux tout tous toute meme faire ' +
		'peut dont alors apres avant chez sans sous vers chaque autre autres quand tres ' +
		'bien encore toujours jamais rien l d qu j n s c m t y').split(/\s+/),

	de: ('der die das und ist nicht ein eine einen einem einer mit sich auf fur von vom ' +
		'dem den des zu zum zur es im in dass er sie als auch nach werden wird wurde bei ' +
		'aus um oder aber wenn dann nur noch schon uber unter durch gegen ohne zwischen ' +
		'kann konnen muss sollen war waren sind sein hat haben hatte diese dieser dieses ' +
		'man wie so mehr sehr bereits jedoch dabei damit dazu').split(/\s+/),

	es: ('el la los las de del que y en un una unos unas es por con para no se su sus al ' +
		'lo como mas pero si ya este esta estos estas ese esa son ser esta estan fue han ' +
		'ha hay le les me te nos os mi tu muy tambien tan entre sobre desde hasta cuando ' +
		'donde porque aunque sino todo todos toda dos tres otros otra mismo').split(/\s+/),

	it: ('il lo la i gli le di del della dei delle che e ed in un uno una e per con non ' +
		'si su al allo alla come ma se gia questo questa questi queste sono essere era ' +
		'erano ha hanno ho hai mi ti ci vi piu anche tra fra dal dalla nel nella sul ' +
		'sulla quando dove perche pero quindi ancora sempre molto tutto tutti').split(/\s+/),

	pt: ('o a os as de do da dos das que e em um uma por com nao se seu sua seus suas ' +
		'ao aos a as como mais mas ja este esta estes estas esse essa sao ser foi foram ' +
		'ha tem eu voce ele ela nos muito tambem entre sobre desde ate quando onde ' +
		'porque porem entao outro outra todos').split(/\s+/),

	nl: ('de het een en van is in dat op te zijn met voor niet aan er om ook als dan maar ' +
		'bij of uit door over na nog wordt worden was waren hij zij wij je ik kan kunnen ' +
		'moet hebben heeft had deze dit die zich naar tot tussen zonder wel geen al meer ' +
		'zeer').split(/\s+/),
};

// 语言的中文名，用于给用户写拒绝理由
WordFreq.langdata.names = {
	en: '英语',
	fr: '法语',
	de: '德语',
	es: '西班牙语',
	it: '意大利语',
	pt: '葡萄牙语',
	nl: '荷兰语',
};

// 书写系统的中文名，用于给用户写拒绝理由
WordFreq.langdata.scriptNames = {
	CJK: '中日韩文字',
	Cyrillic: '西里尔字母',
	Greek: '希腊字母',
	Arabic: '阿拉伯字母',
	Hebrew: '希伯来字母',
	Devanagari: '天城文',
	Thai: '泰文',
	Other: '其它非拉丁文字',
};

// 把表转成 Set，判定时逐个查
WordFreq.langdata.sets = (function () {
	var out = {};
	for (var code in WordFreq.langdata) {
		if (code === 'names' || code === 'scriptNames' || code === 'sets') {
			continue;
		}
		var set = new Set();
		var list = WordFreq.langdata[code];
		for (var i = 0; i < list.length; i++) {
			if (list[i]) {
				set.add(list[i]);
			}
		}
		out[code] = set;
	}
	return out;
})();
