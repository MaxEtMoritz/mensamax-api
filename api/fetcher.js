require('dotenv').config();
const cheerio = require('cheerio');
const axios = require('axios').default;
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const institutions = require('../institutions.json');
const jar = new CookieJar();
const client = wrapper(axios.create({ jar, timeout: 30_000 }));
// =========
process.env.CACHE_TIME_MINUTES = parseInt(process.env.CACHE_TIME_MINUTES || 1);
// =========
let redisclient = undefined;
if (process.env.CACHE === 'redis') {
	if (process.env.CACHE_REDIS_URL) {
		const Redis = require('ioredis');
		redisclient = new Redis(process.env.CACHE_REDIS_URL);
	} else {
		process.env.CACHE = 'memory';
	}
}
const mensaplanCache = [];
// =========
function getCalendarWeek() {
	Date.prototype.getWeek = function () {
		var date = new Date(this.getTime());
		date.setHours(0, 0, 0, 0);
		// Thursday in current week decides the year.
		date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
		// January 4 is always in week 1.
		var week1 = new Date(date.getFullYear(), 0, 4);
		// Adjust to Thursday in week 1 and count number of weeks from date to week1.
		return (
			1 +
			Math.round(
				((date.getTime() - week1.getTime()) / 86400000 -
					3 +
					((week1.getDay() + 6) % 7)) /
					7
			)
		);
	};
	return new Date().getWeek();
}
// =========
function updateCacheItem(key, data) {
	if (process.env.CACHE === 'redis') {
		redisclient.set(key, data, 'EX', process.env.CACHE_TIME_MINUTES * 60);
	} else {
		mensaplanCache.push({
			ts: Date.now(),
			data,
			key
		});
	}
}
async function getCacheItem(key) {
	return new Promise(async (resolve, reject) => {
		if (process.env.CACHE === 'redis') {
			let cacheItem = await redisclient.get(key);
			if (cacheItem) {
				resolve({ data: cacheItem });
			} else {
				resolve(undefined);
			}
		} else {
			const expiry =
				Date.now() - process.env.CACHE_TIME_MINUTES * 60 * 1000;
			const cacheItem = mensaplanCache.find(
				(i) => i.ts > expiry && i.key === key
			);
			if (cacheItem) {
				resolve(cacheItem);
			} else {
				resolve(undefined);
			}
		}
	});
}
/**
 * @returns {string} base url of provider
 */
function getProvider({ p, e }) {
	const f = institutions.find(function (ins) {
		return ins.project === p && ins.facility === e;
	});
	return f.provider;
}
/**
 * @returns {{__EVENTVALIDATION:string,__VIEWSTATE:string,__VIEWSTATEGENERATOR:string,kw:string,data:string}} (cache-backed) html content of mensaplan
 */
function getMensaPlanHTML({ p, e, kw = getCalendarWeek(), provider = undefined, __EVENTVALIDATION=undefined, __VIEWSTATE=undefined, __VIEWSTATEGENERATOR=undefined, nextWeek=false }) {
	return new Promise(async function (resolve, reject) {
		if(!provider)
			provider = getProvider({ p, e });
		if (!provider) {
			reject('404');
		}
		if(nextWeek){
			kw++
		}
		let cache = undefined;
		if (process.env.CACHE !== 'none') {
			cache = await getCacheItem(`${p}_${e}_${provider}_${kw}`);
		}
		if (cache) {
			resolve(cache.data);
		} else {
			const d = await fetchHTML({
				p,
				e,
				provider,
				kw,
				auth: Boolean(__EVENTVALIDATION) && Boolean(__VIEWSTATE) && Boolean(__VIEWSTATEGENERATOR),
				nextWeek,
				__EVENTVALIDATION,
				__VIEWSTATE,
				__VIEWSTATEGENERATOR
			});
			updateCacheItem(`${p}_${e}_${provider}_${kw}`, d);
			resolve(d);
		}
	});
}
// =========
/**
 * @returns {Promise<{__EVENTVALIDATION:string,__VIEWSTATE:string,__VIEWSTATEGENERATOR:string,kw:string,data:string}>} html content + previous state of mensaplan
 */
async function fetchHTML({
	p,
	e,
	provider,
	kw = getCalendarWeek(),
	auth = false,
	nextWeek = false,
	__EVENTVALIDATION = '',
	__VIEWSTATE = '',
	__VIEWSTATEGENERATOR = ''
}) {
	if (!provider) {
		provider = getProvider({ p, e });
	}
	let requestData = undefined;
	let requestMethod = 'GET';
	let url = `https://${provider}/LOGINPLAN.ASPX`;
	if (auth === true) {
		requestData = {
			__VIEWSTATE,
			__EVENTVALIDATION,
			__VIEWSTATEGENERATOR,
			btnLogin: ''
		};
		requestMethod = 'POST';
	}
	if (nextWeek) {
		if(!requestData)
			requestData = {}
		requestData.btnVor = '>';
		requestData.__EVENTARGUMENT = '';
		requestData.__EVENTTARGET = '';
		url = `https://${provider}/mensamax/Wochenplan/WochenplanExtern/WochenPlanExternForm.aspx`;
	}
	//console.debug('requesting', requestMethod, url, requestData, p, e)
	const { data } = await client.request({
		url,
		params: { p, e },
		method: requestMethod,
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		data: requestData
	});
	if(data.includes('Ihre Sitzung ist abgelaufen')){
		// establish new session
		// maybe rate limit?
		console.debug('session expired')
		await new Promise(resolve=>setTimeout(resolve,2000));
		return await fetchHTML({
			p,
			e,
			provider,
			kw,
			nextWeek
		})
	}
	const $ = cheerio.load(data);
	if($('#lblHinweis').text() || $('#lblFehler').text())
		throw new Error('MensaMax Error: ' + $('#lblHinweis').text() || $('#lblFehler').text())
	__EVENTVALIDATION = $('#__EVENTVALIDATION').val();
	__VIEWSTATE = $('#__VIEWSTATE').val();
	__VIEWSTATEGENERATOR = $('#__VIEWSTATEGENERATOR').val();
	if (data.includes('btnLogin')) {
		return await fetchHTML({
			p,
			e,
			provider,
			kw,
			auth: true,
			__EVENTVALIDATION,
			__VIEWSTATE,
			__VIEWSTATEGENERATOR
		});
	}
	//
	let kwText = $('#lblWoche').text()
	if(!kwText.match(/\(KW(\d+)\)/))
		throw new Error('MensaMax Error: '+$('#lblFehler').text())
	kwText = kwText.match(/\(KW(\d+)\)/)[1]
	/*if (kwText.includes(`(KW${kw})`))*/ return {__EVENTVALIDATION, __VIEWSTATE, __VIEWSTATEGENERATOR, data, kw: kwText};
	return await fetchHTML({
		p,
		e,
		provider,
		kw,
		auth: true,
		nextWeek: true,
		__EVENTVALIDATION,
		__VIEWSTATE,
		__VIEWSTATEGENERATOR
	});
}
exports.getMensaPlanHTML = getMensaPlanHTML;
exports.fetchHTML = fetchHTML;
