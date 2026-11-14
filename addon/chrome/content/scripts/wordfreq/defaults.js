/* 默认自定义名单：第一次用这个插件时，名单里应当已经有这些词。
 *
 * 选词标准是「最简单、最没必要在词表里占一行」的那批：冠词、代词、介词、
 * 连词、助动词与情态动词、基础数词、最常见的动词与形容词、以及少量虚词。
 * 学术文献里这些词出现频率极高，却几乎不值得单独看，所以默认就把它们藏掉。
 *
 * 只增不删地维护这份表：删词会让老用户和新用户看到的词表不一致。
 * `userlist.resetToDefault()` 会把名单整体恢复成这一份。
 */
var WordFreq = WordFreq || {};
WordFreq.defaultUserList = [
	// 冠词、代词、指示词
	'a', 'an', 'the',
	'i', 'me', 'my', 'mine', 'myself',
	'we', 'us', 'our', 'ourselves',
	'you', 'your', 'yourself', 'yourselves',
	'he', 'him', 'his', 'himself',
	'she', 'her', 'herself',
	'it', 'its', 'itself',
	'they', 'them', 'their', 'themselves',
	'this', 'that', 'these', 'those',
	'who', 'whom', 'whose', 'which', 'what', 'whatever', 'whoever',
	'one', 'someone', 'somebody', 'something',
	'anyone', 'anybody', 'anything', 'everyone', 'everybody', 'everything',
	'no one', 'nobody', 'nothing',
	'some', 'any', 'all', 'both', 'each', 'every', 'either', 'neither',
	'few', 'many', 'much', 'more', 'most', 'less', 'least',
	'other', 'another', 'such', 'own', 'same',
	// be 与助动词、情态动词
	'be',
	'have',
	'do',
	'can', 'may', 'must', 'shall', 'will',
	'ought', 'need', 'dare', 'let',
	// 介词与方位
	'of', 'in', 'on', 'at', 'to', 'from', 'by', 'with', 'without', 'for',
	'about', 'against', 'among', 'around', 'before', 'after', 'behind',
	'below', 'beneath', 'beside', 'between', 'beyond', 'during', 'except',
	'inside', 'outside', 'into', 'onto', 'over', 'under', 'through',
	'throughout', 'toward', 'towards', 'upon', 'within', 'via', 'across',
	'along', 'as', 'than', 'like', 'unlike', 'despite', 'per', 'since',
	'until', 'till', 'up', 'down', 'off', 'out', 'away', 'back', 'here', 'there',
	// 连词与连接词
	'and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'then', 'else', 'because',
	'although', 'though', 'while', 'whereas', 'unless', 'whether', 'when',
	'whenever', 'where', 'wherever', 'why', 'how', 'however', 'therefore',
	'thus', 'hence', 'moreover', 'furthermore', 'otherwise', 'instead',
	'also', 'too', 'again', 'still', 'already', 'just', 'only', 'even',
	'not', 'no', 'yes', 'never', 'always', 'often', 'sometimes', 'usually',
	'perhaps', 'maybe', 'indeed', 'rather', 'quite', 'very',
	'really', 'almost', 'nearly',
	// 基础数词与量词
	'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
	'eleven', 'twelve', 'twenty', 'hundred', 'thousand', 'million',
	'first', 'second', 'third', 'last', 'next', 'half', 'part',
	// 最常见的动词
	'go', 'come', 'get',
	'make', 'take',
	'give', 'see',
	'look', 'say', 'tell',
	'know', 'think', 'want',
	'use', 'find', 'put', 'keep',
	'seem', 'mean', 'become',
	'show', 'shown', 'work',
	'call', 'try', 'ask',
	'feel', 'leave', 'turn', 'start',
	'play', 'run', 'move', 'live',
	'die', 'help', 'talk', 'read', 'write',
	'hear', 'watch', 'stop',
	'open', 'close', 'begin',
	'end', 'add', 'change',
	// 最常见的名词与形容词
	'man', 'woman', 'person', 'child',
	'day', 'year', 'time', 'thing',
	'way', 'place', 'case', 'point',
	'kind', 'sort', 'fact', 'reason', 'problem', 'question',
	'answer', 'idea', 'name', 'number', 'word', 'life', 'world',
	'home', 'house', 'school', 'hand', 'eye',
	'head', 'face', 'side', 'group', 'level', 'water',
	'good', 'bad', 'great', 'small', 'large', 'big', 'little', 'long',
	'short', 'high', 'low', 'old', 'new', 'young', 'right', 'wrong',
	'true', 'false', 'full', 'empty', 'easy', 'hard',
	'important', 'different', 'possible', 'sure', 'clear', 'common',
	'simple', 'certain', 'main', 'whole', 'real',
];
