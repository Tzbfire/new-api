// Compatibility shim for mdast-util-gfm-autolink-literal.
//
// The upstream mdast transform uses a RegExp lookbehind for email autolinks.
// iOS 16.3 Safari/WebKit cannot parse lookbehind regex literals, so a chunk
// containing remark-gfm can fail during parse and leave the app on a blank page.
// Keep the same public exports, but express the email matcher without lookbehind.

import { ccount } from 'ccount'
import { ok as assert } from 'devlop'
import {
  unicodePunctuation,
  unicodeWhitespace,
} from 'micromark-util-character'
import { findAndReplace } from 'mdast-util-find-and-replace'

const inConstruct = 'phrasing'
const notInConstruct = ['autolink', 'link', 'image', 'label']

export function gfmAutolinkLiteralFromMarkdown() {
  return {
    transforms: [transformGfmAutolinkLiterals],
    enter: {
      literalAutolink: enterLiteralAutolink,
      literalAutolinkEmail: enterLiteralAutolinkValue,
      literalAutolinkHttp: enterLiteralAutolinkValue,
      literalAutolinkWww: enterLiteralAutolinkValue,
    },
    exit: {
      literalAutolink: exitLiteralAutolink,
      literalAutolinkEmail: exitLiteralAutolinkEmail,
      literalAutolinkHttp: exitLiteralAutolinkHttp,
      literalAutolinkWww: exitLiteralAutolinkWww,
    },
  }
}

export function gfmAutolinkLiteralToMarkdown() {
  return {
    unsafe: [
      {
        character: '@',
        before: '[+\\-.\\w]',
        after: '[\\-.\\w]',
        inConstruct,
        notInConstruct,
      },
      {
        character: '.',
        before: '[Ww]',
        after: '[\\-.\\w]',
        inConstruct,
        notInConstruct,
      },
      {
        character: ':',
        before: '[ps]',
        after: '\\/',
        inConstruct,
        notInConstruct,
      },
    ],
  }
}

function enterLiteralAutolink(token) {
  this.enter({ type: 'link', title: null, url: '', children: [] }, token)
}

function enterLiteralAutolinkValue(token) {
  this.config.enter.autolinkProtocol.call(this, token)
}

function exitLiteralAutolinkHttp(token) {
  this.config.exit.autolinkProtocol.call(this, token)
}

function exitLiteralAutolinkWww(token) {
  this.config.exit.data.call(this, token)
  const node = this.stack[this.stack.length - 1]
  assert(node.type === 'link')
  node.url = 'http://' + this.sliceSerialize(token)
}

function exitLiteralAutolinkEmail(token) {
  this.config.exit.autolinkEmail.call(this, token)
}

function exitLiteralAutolink(token) {
  this.exit(token)
}

function transformGfmAutolinkLiterals(tree) {
  findAndReplace(
    tree,
    [
      [/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, findUrl],
      [
        /(^|[\s!"#$%&'()*+,\-.\/:;<=>?@\[\]\\^_`{|}~])([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g,
        findEmail,
      ],
    ],
    { ignore: ['link', 'linkReference'] },
  )
}

function findUrl(_, protocol, domain, path, match) {
  let prefix = ''

  if (!previous(match)) {
    return false
  }

  if (/^w/i.test(protocol)) {
    domain = protocol + domain
    protocol = ''
    prefix = 'http://'
  }

  if (!isCorrectDomain(domain)) {
    return false
  }

  const parts = splitUrl(domain + path)

  if (!parts[0]) return false

  const result = {
    type: 'link',
    title: null,
    url: prefix + protocol + parts[0],
    children: [{ type: 'text', value: protocol + parts[0] }],
  }

  if (parts[1]) {
    return [result, { type: 'text', value: parts[1] }]
  }

  return result
}

function findEmail(_, prefix, atext, label) {
  if (prefix === '/' || /[-\d_]$/.test(label)) {
    return false
  }

  const result = {
    type: 'link',
    title: null,
    url: 'mailto:' + atext + '@' + label,
    children: [{ type: 'text', value: atext + '@' + label }],
  }

  return prefix ? [{ type: 'text', value: prefix }, result] : result
}

function isCorrectDomain(domain) {
  const parts = domain.split('.')

  if (
    parts.length < 2 ||
    (parts[parts.length - 1] &&
      (/_/.test(parts[parts.length - 1]) ||
        !/[a-zA-Z\d]/.test(parts[parts.length - 1]))) ||
    (parts[parts.length - 2] &&
      (/_/.test(parts[parts.length - 2]) ||
        !/[a-zA-Z\d]/.test(parts[parts.length - 2])))
  ) {
    return false
  }

  return true
}

function splitUrl(url) {
  const trailExec = /[!"&'),.:;<>?\]}]+$/.exec(url)

  if (!trailExec) {
    return [url, undefined]
  }

  url = url.slice(0, trailExec.index)

  let trail = trailExec[0]
  let closingParenIndex = trail.indexOf(')')
  const openingParens = ccount(url, '(')
  let closingParens = ccount(url, ')')

  while (closingParenIndex !== -1 && openingParens > closingParens) {
    url += trail.slice(0, closingParenIndex + 1)
    trail = trail.slice(closingParenIndex + 1)
    closingParenIndex = trail.indexOf(')')
    closingParens++
  }

  return [url, trail]
}

function previous(match, email) {
  const code = match.input.charCodeAt(match.index - 1)

  return (
    (match.index === 0 || unicodeWhitespace(code) || unicodePunctuation(code)) &&
    (!email || code !== 47)
  )
}
