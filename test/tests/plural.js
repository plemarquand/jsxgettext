"use strict";

var fs = require('fs');
var path = require('path');

var jsxgettext = require('../../lib/jsxgettext');
var utils = require('../utils');

exports['test with multiple keywords'] = function (assert, cb) {
  var inputFilename = path.join(__dirname, '..', 'inputs', 'plural.js');
  fs.readFile(inputFilename, "utf8", function (err, source) {
    var options = {keyword: ['tr']};
    var result = jsxgettext.generate({'inputs/plural.js': source}, options);

    assert.equal(typeof result, 'string', 'result is a string');
    assert.ok(result.length > 0, 'result is not empty');

    var outputFilename = path.join(__dirname, '..', 'outputs', 'plural.pot');

    utils.compareResultWithFile(result, outputFilename, assert, cb);
  });
};

if (module === require.main) require('test').run(exports);
