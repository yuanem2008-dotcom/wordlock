// 「一个合法的目标词长什么样」的唯一来源。
//
// 为什么要集中在一处：会话绑定的词、输入校验的词、词典查询的词，三者必须用**同一套归一化**，
// 否则会出现"存的是 A、比的是 B"这类门禁漏洞；而且客户端 state-machine.js 里有一份等价实现，
// 改这里时请同步改那边（有单元测试分别覆盖两者）。
//
// 允许：英文字母，以及**词与词之间的**空格 / 连字符 / 撇号（词典里有 "nice day"、"well-known"、"don't"）。
// 不允许：首尾是分隔符、连续分隔符、数字、汉字等其它字符。

export const WORD_RE = /^[a-z]+(?:[ '-][a-z]+)*$/;

// 归一化：去首尾空白、转小写、把连续空白折叠成一个空格
export function normalizeWord(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isValidWord(word) {
  return WORD_RE.test(word);
}
