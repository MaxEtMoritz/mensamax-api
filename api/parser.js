const cheerio = require('cheerio');
function chunk(arr, len) {
	let chunks = [];
	let i = 0;
	let n = arr.length;
	while (i < n) {
		chunks.push(arr.slice(i, (i += len)));
	}
	return chunks;
}
/**
 * @typedef {Object} MensaplanResponse
 * @property {Object} json parsed json object containing all days as keys and days/ food items as object values
 * @property {string} html human readable html version of mensaplan
 * @property {string} hinweis note of the institution/ kitchen
 * @property {Array} categories array of available categories in the mensaplan
 * @property {string} timeRange start and end date of mensaplan along with calendar week if available
 * @property {Array} days array of days in this mensaplan
 * @property {Array} elements_unchunked unchunked array of food/ day items in this mensaplan
 */
/**
 * @returns {MensaplanResponse} MensaplanResponse
 */
exports.parser = (input) => {
	return new Promise(function (resolve, reject) {
		try {
			let tmp = cheerio.load(input);
			const timeRange = tmp('#lblWoche').text();
			const hinweis = tmp('#lblSpeiesplanHinweis').text();
			// drop all attributes + unneeded elements for better parsing
			tmp('*')
				.removeAttr('valign')
				.removeAttr('colspan')
				.removeAttr('align')
				.removeAttr('border')
				.removeAttr('cellpadding')
				.removeAttr('onclick');
			tmp('img').parent().remove();
			tmp('input').remove();
			tmp('script').remove();
			tmp('#strDetails').parent().parent().remove();
			tmp('table[id^=tblrating]').parent().parent().remove();
			let $ = cheerio.load(tmp('#tblMain').html(), null, false);
			let days = [];
			$('.tdHeader th').each((i, e) => {
				days.push($(e).html());
			});
			days = days.filter((h) => h !== '');
			let categories = [];
			let elements = [];
			$.root()
				.children('tbody')
				.children('tr')
				.each((i, category) => {
					let $c = $(category);
					if (!$c.text().trim()) {
						return;
					} else {
						$c.children('td').each((i, day) => {
							let $d = $(day);
							if ($d.children().length == 0) {
								if($d.attr('style')?.includes('font-weight:bold')){
									if (!categories.includes($d.text().trim())) {
										categories.push($d.text().trim());
										return;
									}
								} else {
									elements.push([])
									return
								}
							} else {
								let items = [];
								$d.find('div').each((i, meal) => {
									let $m = $(meal);
									let allergens = [];
									$m.find('sub>span').each((i, all) => {
										allergens.push($(all).attr('title'));
									});
									$m.children('sub').remove();
									let title = $m
										.text()
										.trim()
										.replace(/^\d[^\s]+/, '')
										.trim();
									items.push({
										title,
										additives_allergies: allergens
									});
								});
								elements.push(items);
							}
						});
					}
				});

			const elements_unchunked = elements;
			elements = chunk(elements, days.length);
			// parse elements into final json structure
			let out = {};
			let index = 0;
			categories.forEach((c) => {
				let i = 0;
				days.forEach((d) => {
					if (!out[`${days[i]}`]) {
						out[`${days[i]}`] = {};
					}
					out[`${days[i]}`][`${categories[index]}`] =
						elements[index][i];
					i++;
				});
				index++;
			});
			resolve({
				json: out,
				html: tmp,
				hinweis,
				categories,
				timeRange,
				days,
				elements_unchunked
			});
		} catch (e) {
			reject(e);
		}
	});
};
