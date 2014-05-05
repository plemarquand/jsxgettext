"use strict";

var fs = require('fs');
var path = require('path');

var jsxgettext = require('../../lib/jsxgettext');
var utils = require('../utils');

exports['test translations with comments'] = function (assert, cb) {
  var inputFilename = path.join(__dirname, '..', 'inputs', 'contextual_comments.js');
  fs.readFile(inputFilename, "utf8", function (err, source) {
    var options = {keyword: ['tr'], add_comments: '/'};
    var result = jsxgettext.generate({'inputs/contextual_comments.js': source}, options);

    assert.equal(typeof result, 'string', 'result is a string');
    assert.ok(result.length > 0, 'result is not empty');

    var outputFilename = path.join(__dirname, '..', 'outputs', 'contextual_comments.pot');

    utils.compareResultWithFile(result, outputFilename, assert, cb);
  });
};

if (module === require.main) require('test').run(exports);
