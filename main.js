const { fetchHTML, getMensaPlanHTML, fetchImpressum } = require('./api/fetcher');
const { parser, parseImpressum } = require('./api/parser');
const institutions = require('./institutions.json');
//
exports.getMensaPlanHTML = getMensaPlanHTML;
exports.fetchHTML = fetchHTML;
exports.fetchImpressum = fetchImpressum;
exports.parser = parser;
exports.parseImpressum = parseImpressum;
exports.institutions = institutions;
