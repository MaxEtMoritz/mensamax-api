const cheerio = require('cheerio');
var parser = require('fast-xml-parser');
const fs = require('fs');
const minify = require('html-minifier').minify;
function chunk(arr, len) {
	let chunks = [];
	let i = 0;
	let n = arr.length;
	while (i < n) {
		chunks.push(arr.slice(i, (i += len)));
	}
	return chunks;
}
exports.parser = (input) => {
	return new Promise(function (resolve, reject) {
		try {
			let tmp = cheerio.load(input);
			const timeRange = tmp('#lblWoche').text()
			// drop all attributes + unneeded elements for better parsing
			tmp('*')
				.removeAttr('style')
				.removeAttr('class')
				.removeAttr('valign')
				.removeAttr('colspan')
				.removeAttr('align')
				.removeAttr('border')
				.removeAttr('cellpadding')
				.removeAttr('alt')
				.removeAttr('title')
				.removeAttr('onclick');
			tmp('img').parent().remove();
			tmp('input').remove();
			tmp('script').remove();
			tmp('#strDetails').parent().parent().remove();
			tmp('td').removeAttr('id');
			tmp('tr').removeAttr('id');
			tmp = tmp("#tblMain").parent().html()
			tmp = tmp.replaceAll('<td>•&nbsp;</td>', '');
			// minify html for easier parsing
			tmp = minify(tmp, {
				useShortDoctype: true,
				minifyCSS: true,
				collapseWhitespace: true
			});
			// remove empty food items
			tmp = tmp.replaceAll('<tr><td></td></tr>', '');
			tmp = tmp.replaceAll('<td></td><td></td><td></td><td></td><td></td>', '');
			tmp = tmp.replaceAll('</div></td></tr></tbody></table></td></tr></tbody></table></td><td><table><tbody><tr><td><table><tbody><tr><td><div>', '</food></day><day><food>');
			tmp = tmp.replaceAll('<td><table><tbody><tr><td><table><tbody><tr><td><div>', '<day><food>');
			tmp = tmp.replaceAll('</div></td></tr><tr><td><div>', '</food><food>');
			tmp = tmp.replaceAll('</div></td></tr></tbody></table></td></tr></tbody></table></td>', '</food></day>');
			tmp = tmp.replaceAll('</day><td></td><food>', '</day><day></day><day><food>');
			tmp = tmp.replaceAll('<td></td>', '<day></day>');
			tmp = tmp.replaceAll('</tr><tr>', '');
			tmp = tmp.replaceAll('</th><td>', '</tr></th><td>');
			tmp = tmp.replaceAll('</tr></tbody></table>', '</tbody></table>');
			// begin parsing: load html into cheerio object
			let $ = cheerio.load(input);
			const hinweis = $('#lblSpeiesplanHinweis').text();
			let days = [];
			$('.tdHeader th').each((i, e) => {
				days.push($(e).html());
			});
			days = days.filter((h) => h !== '');
			// ==========
			// load preprocessed html into cheerio object
			$ = cheerio.load(tmp)
			let out = {}
			let categories = []
			let items = []
			fs.writeFileSync("./outdemo.html", tmp)
			resolve(out);
		} catch (e) {
			reject(e);
		}
	})
}