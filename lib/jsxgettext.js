"use strict";

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var fs   = require('fs');
var path = require('path');

var parser        = require('acorn');
var traverse      = require('acorn/util/walk').simple;
var gettextParser = require('gettext-parser');

function isStringLiteral(node) {
  return node.type === 'Literal' && (typeof node.value === 'string');
}

function isStrConcatExpr(node) {
  var left = node.left;
  var right = node.right;

  return node.type === "BinaryExpression" && node.operator === '+' && (
      (isStringLiteral(left) || isStrConcatExpr(left)) &&
      (isStringLiteral(right) || isStrConcatExpr(right))
  );
}

function isValidArg(arg) {
  return (arg && (isStrConcatExpr(arg) || isStringLiteral(arg)));
}

function extractArgs(args) {
  var results = args.filter(function(arg) {
    return isValidArg(arg);
  });
  return results.length > 0 ? results : false;
}

function trim(str) {
  return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
}

// Given a comment, search a list of comments for one that preceeds
// it in the code and append it to the needle comment's value. This
// aggregates multi line comments together.
function aggregateCommentParents(comment, comments) {
  var len = comments.length;
  for(var i = 0; i < len; i++) {
    var prevComment = comments[i];
    if(prevComment.line.line === comment.line.line - 1) {
      comment.line.line = prevComment.line.line;
      comment.value = prevComment.value + '\n' + comment.value;
      return aggregateCommentParents(comment, comments);
    }

    // We're not going to find any parent comments after the
    // needle's line #.
    if(prevComment.line > comment.line) {
      return comment;
    }
  }
  return comment;
}

// finds comments that end on the previous line
function findComments(comments, line) {
  var comment = comments.filter(function (node) {
    var commentLine = node.line.line;
    return (commentLine === line || commentLine + 1 === line);
  })[0]; // TODO: Pretty inefficient
  if(comment) {
    return aggregateCommentParents(comment, comments);
  }
  return comment;
}

function getTranslatable(node, options) {
  // must be a call expression with arguments
  if (!node.arguments)
    return false;

  var callee = node.callee;
  var funcName = callee.name;
  var args = node.arguments;
  var prop;

  if (!funcName) {
    if (callee.type !== 'MemberExpression')
      return false;

    // Special case for functionName.call calls
    if (callee.property.name === 'call') {
      prop = callee.object.property;
      funcName = callee.object.name || prop && (prop.name || prop.value);
      args = node.arguments.slice(1); // skip context object
    } else {
      funcName = callee.property.name;
    }
  }

  if (options.keyword.indexOf(funcName) === -1)
    return false;

  var parsedArguments = extractArgs(args);
  if(parsedArguments) {
    return parsedArguments;
  }

  if (options.sanity)
    throw new Error("Could not parse translatable: " + JSON.stringify(args, null, 2));
}

// Assumes node is either a string Literal or a strConcatExpression
function extractStr(node) {
  if (isStringLiteral(node))
    return node.value;
  else
    return extractStr(node.left) + extractStr(node.right);
}

function loadStrings(poFile) {
  try {
    return gettextParser.po.parse(fs.readFileSync(path.resolve(poFile)), "utf-8");
  } catch (e) {
    return null;
  }
}

// generate extracted strings file
function gen(sources, options) {
  var useExisting = options['join-existing'];
  var poJSON;
  if (useExisting)
    poJSON = loadStrings(path.resolve(path.join(options['output-dir'] || '', options.output)));

  if (!poJSON)
    poJSON = {
      charset: "utf-8",
      headers: {
        "project-id-version": "PACKAGE VERSION",
        "language-team": "LANGUAGE <LL@li.org>",
        "po-revision-date": "YEAR-MO-DA HO:MI+ZONE",
        "language": "",
        "mime-version": "1.0",
        "content-type": "text/plain; charset=utf-8",
        "content-transfer-encoding": "8bit"
      },
      translations: {'': {} }
    };

  var translations;

  try {
    poJSON.headers["pot-creation-date"] = new Date().toISOString().replace('T', ' ').replace(/:\d{2}.\d{3}Z/, '+0000');

    // Always use the default context for now
    // TODO: Take into account different contexts
    translations = poJSON.translations[''];
  } catch (err) {
    if (useExisting)
      throw new Error("An error occurred while using the provided PO file. Please make sure it is valid by using `msgfmt -c`.");
    else
      throw err;
  }

  options.keyword = options.keyword || ['gettext'];
  var commentKey = options.add_comments || '';
  Object.keys(sources).forEach(function (filename) {
    var source   = sources[filename].replace(/^#.*/, ''); // strip leading hash-bang
    var astComments = [];
    var ast      = parser.parse(source, {
      onComment: function (block, text, start, end, line/*, column*/) {
        text = text.replace(/^\s*L10n:/, '');

        if (!text)
          return;

        var isExtracted = commentKey.length && text.indexOf(commentKey) === 0;
        var type = isExtracted ? 'extracted' : 'translator';
        astComments.push({
          line : line,
          value: trim(isExtracted ? text.substr(commentKey.length) : text),
          type: type
        });
      },
      locations: true
    });

    traverse(ast, {'CallExpression': function (node) {
        var args = getTranslatable(node, options);
        if (!args)
          return;

        var msgid = extractStr(args[0]);
        var line = node.loc.start.line;
        var comment = findComments(astComments, line);
        var ref = filename + ':' + line;
        if (!translations[msgid]) {
          translations[msgid] = {
            msgid: msgid,
            msgstr: [],
            comments: {
              reference: ref
            }
          };

          if(args.length > 1) {
            translations[msgid].msgid_plural = extractStr(args[1]);
            translations[msgid].msgstr = ['', ''];
          }

          if(comment) {
            translations[msgid].comments[comment.type] = comment.value;
          }

        } else {
          translations[msgid].comments.reference +=  '\n' + ref;
          if (comment) {
            translations[msgid].comments[comment.type] = translations[msgid].comments[comment.type] || '';
            translations[msgid].comments[comment.type] += '\n' + comment.value;
          }
        }
      }
    });

    function dedupeNCoalesce(item, i, arr) {
      return item && arr.indexOf(item) === i;
    }

    Object.keys(translations).forEach(function (msgid) {
      var comments = translations[msgid].comments;

      if (!comments)
        return;

      if (comments.reference)
        comments.reference = comments.reference.split('\n').filter(dedupeNCoalesce).join('\n');
      if (comments.translator)
        comments.translator = comments.translator.split('\n').filter(dedupeNCoalesce).join('\n');
      if (comments.extracted)
        comments.extracted = comments.extracted.split('\n').filter(dedupeNCoalesce).join('\n');
    });
  });

  return gettextParser.po.compile(poJSON).toString();
}

exports.generate = gen;

// Backwards compatibility interface for 0.3.x - Deprecated!
var parsers = require('./parsers');

Object.keys(parsers).forEach(function (parser) {
  parser = parsers[parser];
  exports['generateFrom' + parser.name] = parser;
});
