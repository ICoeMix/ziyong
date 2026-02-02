// --- 核心配置 ---
const BASE_DATA_URL = "https://raw.githubusercontent.com/opix-maker/Forward/main";
const RECENT_DATA_URL = `${BASE_DATA_URL}/recent_data.json`;

// --- 动态年份生成 ---
const currentYear = new Date().getFullYear();
const yearOptions = [];
for (let year = currentYear; year >= 1940; year--) { 
    yearOptions.push({ title: `${year}`, value: `${year}` });
}

var WidgetMetadata = {
    id: "bangumi-tmdb_v3_fast",
    title: "Bangumi 热门榜单 (极速版)",
    description: "优化请求策略，大幅提升加载速度。强制横版封面，包含 genre_ids。",
    version: "3.3.0",
    author: "ICoeMix(Optimized)",
    site: "https://github.com/ICoeMix/Forward-Widget",
    requiredVersion: "0.0.1",
    detailCacheDuration: 6000,
    modules: [
        {
            title: "近期热门",
            description: "按作品类型浏览近期热门 (需有横版封面)",
            requiresWebView: false,
            functionName: "fetchRecentHot",
            cacheDuration: 300000, // 热门数据缓存 5分钟
            params: [
                { name: "category", title: "分类", type: "enumeration", value: "anime", enumOptions: [ { title: "动画", value: "anime" } ] },
                { name: "pages", title: "页码范围", type: "input", value: "1", description: "建议只填 1，页数越多速度越慢" },
                {
                    name: "sort", title: "排序方式", type: "enumeration", value: "default",
                    enumOptions: [ { title: "默认", value: "default" }, { title: "发行时间", value: "date" }, { title: "评分", value: "score" } ]
                }
            ]
        },
        {
            title: "年度/季度榜单",
            description: "浏览特定年份季度的排行 (需有横版封面)",
            requiresWebView: false,
            functionName: "fetchAirtimeRanking",
            cacheDuration: 1000000,
            params: [
                { name: "category", title: "分类", type: "enumeration", value: "anime", enumOptions: [ { title: "动画", value: "anime" }, { title: "三次元", value: "real" } ] },
                { name: "year", title: "年份", type: "enumeration", value: `${currentYear}`, enumOptions: yearOptions },
                { name: "month", title: "月份/季度", type: "enumeration", value: "all", enumOptions: [ { title: "全年", value: "all" }, { title: "冬季 (1月)", value: "1" }, { title: "春季 (4月)", value: "4" }, { title: "夏季 (7月)", value: "7" }, { title: "秋季 (10月)", value: "10" } ] },
                { name: "sort", title: "排序方式", type: "enumeration", value: "collects", enumOptions: [ { title: "排名", value: "rank" }, { title: "热度", value: "trends" }, { title: "收藏数", value: "collects" }, { title: "发售日期", value: "date" } ] },
                { name: "page", title: "页码", type: "page", value: "1" }
            ]
        },
        {
            title: "每日放送",
            description: "查看每日更新 (速度优化版)",
            requiresWebView: false,
            functionName: "fetchDailyCalendarApi",
            cacheDuration: 20000,
            params: [
                {
                    name: "filterType", title: "筛选范围", type: "enumeration", value: "today",
                    enumOptions: [ { title: "今日放送", value: "today" }, { title: "指定单日", value: "specific_day" }, { title: "本周一至四", value: "mon_thu" }, { title: "本周五至日", value: "fri_sun" }, { title: "整周放送", value: "all_week" } ]
                },
                {
                    name: "specificWeekday", title: "选择星期", type: "enumeration", value: "1",
                    belongTo: { paramName: "filterType", value: ["specific_day"] },
                    enumOptions: [ { title: "周一", value: "1" }, { title: "周二", value: "2" }, { title: "周三", value: "3" }, { title: "周四", value: "4" }, { title: "周五", value: "5" }, { title: "周六", value: "6" }, { title: "周日", value: "7" } ]
                },
                {
                    name: "dailyRegionFilter", title: "地区筛选", type: "enumeration", value: "all",
                    enumOptions: [ { title: "全部", value: "all" }, { title: "日本", value: "JP" }, { title: "中国大陆", value: "CN" } ]
                }
            ]
        }
    ]
};

// --- 全局变量 ---
let globalData = null;
let dataFetchPromise = null;
const archiveFetchPromises = {};

// 获取并缓存全局数据
async function fetchAndCacheGlobalData() {
    if (globalData) return globalData;
    if (dataFetchPromise) return await dataFetchPromise;
    dataFetchPromise = (async () => {
        try {
            // 尝试获取在线数据，失败则初始化空对象，避免整个组件崩溃
            const response = await Widget.http.get(RECENT_DATA_URL, { headers: { 'Cache-Control': 'no-cache' } }).catch(()=>({data:{}}));
            globalData = response.data || {};
            globalData.dynamic = globalData.dynamic || {};
            globalData.airtimeRanking = globalData.airtimeRanking || {};
            globalData.recentHot = globalData.recentHot || {};
            return globalData;
        } catch (e) {
            globalData = { airtimeRanking: {}, recentHot: {}, dailyCalendar: {}, dynamic: {} };
            return globalData;
        }
    })();
    return await dataFetchPromise;
}

// ==================== 核心逻辑：数据处理器 ====================
const DynamicDataProcessor = (() => {
    class Processor {
        static BGM_BASE_URL = "https://bgm.tv";
        static TMDB_ANIMATION_GENRE_ID = 16; 
        // 优化1: 提高并发数，从 8 提到 15，加快批量查询速度
        static MAX_CONCURRENT_DETAILS_FETCH = 15; 
        static tmdbCache = new Map(); 

        static normalizeTmdbQuery(query) { 
            if (!query || typeof query !== 'string') return ""; 
            return query.toLowerCase().trim()
                .replace(/[\[\]【】（）()「」『』:：\-－_,\.・]/g, ' ')
                .replace(/\s+/g, ' ').trim();
        }

        static parseDate(dateStr) { 
            if (!dateStr) return '';
            let match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/); 
            if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
            match = dateStr.match(/(\d{4})年(\d{1,2})月/);
            if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-01`;
            match = dateStr.match(/(\d{4})/);
            if (match) return `${match[1]}-01-01`;
            return '';
        }

        static scoreTmdbResult(result, query, validYear) {
            let score = 0;
            const resultTitle = Processor.normalizeTmdbQuery(result.title || result.name);
            const queryLower = Processor.normalizeTmdbQuery(query);
            if (resultTitle === queryLower) score += 15;
            else if (resultTitle.includes(queryLower)) score += 7;
            if (validYear) {
                const resDate = result.release_date || result.first_air_date;
                if (resDate && resDate.startsWith(validYear)) score += 6;
            }
            score += Math.log10((result.popularity || 0) + 1) * 2.2;
            return score;
        }

        static async searchTmdb(originalTitle, chineseTitle, year) {
            const cacheKey = `${originalTitle}-${chineseTitle}-${year}`;
            if (Processor.tmdbCache.has(cacheKey)) return Processor.tmdbCache.get(cacheKey);

            let bestMatch = null;
            let maxScore = -1;
            const query = chineseTitle || originalTitle;
            
            try {
                // 优化2: 使用 Promise.race 增加简单的超时机制 (3秒)，防止某个卡死的请求拖慢整体
                const fetchPromise = Widget.tmdb.get(`/search/tv`, { 
                    params: { query, language: "zh-CN", include_adult: false, first_air_date_year: year } 
                });
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
                
                const response = await Promise.race([fetchPromise, timeoutPromise]);
                
                const results = response?.results || [];
                for (const result of results) {
                    if (result.genre_ids && !result.genre_ids.includes(Processor.TMDB_ANIMATION_GENRE_ID)) continue;
                    const score = Processor.scoreTmdbResult(result, query, year);
                    if (score > maxScore) {
                        maxScore = score;
                        bestMatch = result;
                    }
                }
            } catch (err) { 
                // 超时或失败忽略
            }

            Processor.tmdbCache.set(cacheKey, bestMatch);
            return bestMatch;
        }

        static async fetchItemDetails(item, category) {
            const yearMatch = item.info?.match(/(\d{4})/) || [];
            const year = yearMatch[1] || '';
            
            const baseItem = {
                id: item.id, type: "link", title: item.title,
                posterPath: item.cover, backdropPath: null,
                releaseDate: Processor.parseDate(item.info),
                mediaType: category, rating: item.rating, description: item.info,
                link: `${Processor.BGM_BASE_URL}/subject/${item.id}`,
                genre_ids: [] 
            };

            const tmdbResult = await Processor.searchTmdb(item.title, null, year);
            
            if (tmdbResult) {
                baseItem.id = String(tmdbResult.id);
                baseItem.type = "tmdb";
                baseItem.title = tmdbResult.name || tmdbResult.title || baseItem.title;
                baseItem.posterPath = tmdbResult.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbResult.poster_path}` : baseItem.posterPath;
                baseItem.backdropPath = tmdbResult.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbResult.backdrop_path}` : null;
                baseItem.releaseDate = tmdbResult.first_air_date || tmdbResult.release_date || baseItem.releaseDate;
                baseItem.rating = tmdbResult.vote_average ? tmdbResult.vote_average.toFixed(1) : baseItem.rating;
                baseItem.description = tmdbResult.overview || baseItem.description;
                baseItem.link = null; 
                baseItem.tmdb_id = String(tmdbResult.id);
                baseItem.tmdb_origin_countries = tmdbResult.origin_country || [];
                
                // 【关键点】: 确认 genre_ids 赋值
                baseItem.genre_ids = tmdbResult.genre_ids || []; 
            }

            // 【关键点】: 无横版封面(backdropPath) 则直接丢弃
            if (!baseItem.backdropPath) return null;

            return baseItem;
        }

        static async processBangumiPage(url, category) {
            try {
                const listHtmlResp = await Widget.http.get(url);
                const $ = Widget.html.load(listHtmlResp.data);
                const pendingItems = [];
                
                $('ul#browserItemList li.item').each((_, element) => {
                    const $item = $(element);
                    const id = $item.attr('id')?.substring(5);
                    if (!id) return;
                    let cover = $item.find('a.subjectCover img.cover').attr('src');
                    if (cover?.startsWith('//')) cover = 'https:' + cover;
                    const title = $item.find('h3 a.l').text().trim();
                    const info = $item.find('p.info.tip').text().trim();
                    const rating = $item.find('small.fade').text().trim();
                    pendingItems.push({ id, title, cover, info, rating });
                });

                const results = [];
                for (let i = 0; i < pendingItems.length; i += Processor.MAX_CONCURRENT_DETAILS_FETCH) {
                    const batch = pendingItems.slice(i, i + Processor.MAX_CONCURRENT_DETAILS_FETCH);
                    const promises = batch.map(item => Processor.fetchItemDetails(item, category));
                    const settled = await Promise.allSettled(promises);
                    settled.forEach(res => {
                        if (res.status === 'fulfilled' && res.value !== null) {
                            results.push(res.value);
                        }
                    });
                }
                return results;
            } catch (error) {
                console.error(error);
                return [];
            }
        }

        // 优化3: processDailyCalendar 支持预筛选
        // 之前的逻辑是：先查所有 TMDB -> 再筛选日期 (极其浪费)
        // 现在的逻辑是：先筛选日期 -> 再查 TMDB (极速)
        static async processDailyCalendar(targetBgmIds = null) {
            try {
                const apiResponse = await Widget.http.get("https://api.bgm.tv/calendar");
                let allItems = [];
                apiResponse.data.forEach(dayData => {
                    if (dayData.items) {
                        dayData.items.forEach(item => {
                            item.bgm_weekday_id = dayData.weekday?.id;
                            allItems.push(item);
                        });
                    }
                });

                // 【提速核心】：如果在请求 TMDB 之前就能过滤掉不需要的日期，可以减少 6/7 的请求量
                if (targetBgmIds) {
                    allItems = allItems.filter(item => targetBgmIds.has(item.bgm_weekday_id));
                }

                const enhancedItems = [];
                for (let i = 0; i < allItems.length; i += Processor.MAX_CONCURRENT_DETAILS_FETCH) {
                    const batch = allItems.slice(i, i + Processor.MAX_CONCURRENT_DETAILS_FETCH);
                    const promises = batch.map(async (item) => {
                        const baseItem = {
                            id: String(item.id), type: "link", title: item.name_cn || item.name,
                            posterPath: item.images?.large?.startsWith('//') ? 'https:' + item.images.large : item.images?.large,
                            backdropPath: null, 
                            releaseDate: item.air_date, mediaType: 'anime', rating: item.rating?.score?.toFixed(1) || "N/A",
                            description: item.summary || '', link: item.url, 
                            bgm_id: String(item.id), bgm_score: item.rating?.score || 0,
                            bgm_rating_total: item.rating?.total || 0, bgm_weekday_id: item.bgm_weekday_id,
                            genre_ids: [] 
                        };

                        const tmdbResult = await Processor.searchTmdb(item.name, item.name_cn, item.air_date?.substring(0, 4));
                        
                        if (tmdbResult) {
                            baseItem.id = String(tmdbResult.id);
                            baseItem.type = "tmdb";
                            baseItem.title = tmdbResult.name || tmdbResult.title || baseItem.title;
                            baseItem.posterPath = tmdbResult.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbResult.poster_path}` : baseItem.posterPath;
                            baseItem.backdropPath = tmdbResult.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbResult.backdrop_path}` : null;
                            baseItem.releaseDate = tmdbResult.first_air_date || tmdbResult.release_date || baseItem.releaseDate;
                            baseItem.rating = tmdbResult.vote_average ? tmdbResult.vote_average.toFixed(1) : baseItem.rating;
                            baseItem.description = tmdbResult.overview || baseItem.description;
                            baseItem.link = null;
                            baseItem.tmdb_id = String(tmdbResult.id);
                            baseItem.tmdb_origin_countries = tmdbResult.origin_country || [];
                            // 【关键点】: 确认 genre_ids 赋值
                            baseItem.genre_ids = tmdbResult.genre_ids || [];
                        }

                        // 【关键点】: 无横版丢弃
                        if (!baseItem.backdropPath) return null;

                        return baseItem;
                    });

                    const settled = await Promise.allSettled(promises);
                    settled.forEach(res => {
                        if (res.status === 'fulfilled' && res.value !== null) enhancedItems.push(res.value);
                    });
                }
                return enhancedItems;
            } catch (error) {
                console.error(error);
                return [];
            }
        }
    }

    return {
        processBangumiPage: Processor.processBangumiPage,
        processDailyCalendar: Processor.processDailyCalendar,
        searchTmdb: Processor.searchTmdb
    };
})();

// ==================== 模块函数 ====================

// 1. 近期热门
async function fetchRecentHot(params = {}) {
    await fetchAndCacheGlobalData();
    const category = params.category || "anime";
    
    let pageList = [];
    const pageInput = params.pages || "1";
    if (pageInput.includes("-")) {
        const [start, end] = pageInput.split("-").map(n => parseInt(n, 10));
        for (let i = start; i <= end; i++) pageList.push(i);
    } else {
        pageList.push(parseInt(pageInput, 10));
    }

    const pages = globalData.recentHot?.[category] || [];
    let resultList = [];
    for (const p of pageList) {
        if (pages[p - 1]) resultList = resultList.concat(pages[p - 1]);
    }

    // 缓存数据也要过一遍 TMDB 以获取 backdrop 和 genre_ids
    const processedList = [];
    // 并发处理缓存数据的补充
    const BATCH_SIZE = 15;
    for(let i=0; i<resultList.length; i+=BATCH_SIZE) {
        const batch = resultList.slice(i, i+BATCH_SIZE);
        const promises = batch.map(async (item) => {
             // 如果已经完美了(有横图且有分类ID)，直接返回
            if (item.backdropPath && item.genre_ids && item.genre_ids.length > 0) return item;

            // 否则重新跑一次 TMDB
            const tmdbResult = await DynamicDataProcessor.searchTmdb(item.title, null, item.releaseDate?.substring(0,4));
            if (tmdbResult && tmdbResult.backdrop_path) {
                item.backdropPath = `https://image.tmdb.org/t/p/w780${tmdbResult.backdrop_path}`;
                item.genre_ids = tmdbResult.genre_ids || [];
                item.type = "tmdb";
                item.id = String(tmdbResult.id); 
                return item;
            }
            return null; 
        });
        
        const results = await Promise.allSettled(promises);
        results.forEach(res => {
            if(res.status === 'fulfilled' && res.value) processedList.push(res.value);
        });
    }

    // 排序
    const sort = params.sort || "default";
    if (sort === "date") processedList.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
    else if (sort === "score") processedList.sort((a, b) => (b.rating || 0) - (a.rating || 0));

    return processedList;
}

// 2. 年度榜单
async function fetchAirtimeRanking(params = {}) {
    await fetchAndCacheGlobalData();
    const category = params.category || "anime";
    const year = params.year || `${new Date().getFullYear()}`;
    const month = params.month || "all";
    const sort = params.sort || "collects";
    const page = parseInt(params.page || "1", 10);
    
    const dynamicKey = `airtime-${category}-${year}-${month}-${sort}-${page}`;
    if (globalData.dynamic[dynamicKey]) return globalData.dynamic[dynamicKey];

    const url = `https://bgm.tv/${category}/browser/airtime/${year}/${month}?sort=${sort}&page=${page}`;
    const listItems = await DynamicDataProcessor.processBangumiPage(url, category);
    
    globalData.dynamic[dynamicKey] = listItems;
    return listItems;
}

// 3. 每日放送 (逻辑大幅优化)
async function fetchDailyCalendarApi(params = {}) {
    await fetchAndCacheGlobalData();
    
    const { filterType = "today", specificWeekday = "1", dailyRegionFilter = "all" } = params;
    const JS_DAY_TO_BGM_API_ID = {0:7,1:1,2:2,3:3,4:4,5:5,6:6};
    
    // 计算需要的 BGM Weekday IDs
    let targetBgmIds = null;
    if (filterType !== "all_week") {
        targetBgmIds = new Set();
        const today = new Date();
        switch (filterType) {
            case "today": targetBgmIds.add(JS_DAY_TO_BGM_API_ID[today.getDay()]); break;
            case "specific_day": targetBgmIds.add(parseInt(specificWeekday,10)); break;
            case "mon_thu": [1,2,3,4].forEach(id=>targetBgmIds.add(id)); break;
            case "fri_sun": [5,6,7].forEach(id=>targetBgmIds.add(id)); break;
        }
    }

    // 【核心变化】: 将筛选条件传给 processor，在查询 TMDB 之前就过滤，极大提升速度
    // 注意：这里不再优先读缓存 globalData.dailyCalendar，因为缓存的是全部数据
    // 如果想利用缓存，逻辑会非常复杂。考虑到速度优化，按需动态获取可能更快。
    // 但为了兼容性，如果用户选的是 all_week，我们还是可以用缓存逻辑（如果需要的话）。
    // 这里为了确保逻辑一致性和 genre_ids 的存在，统一重新 fetch 处理。
    
    const items = await DynamicDataProcessor.processDailyCalendar(targetBgmIds);

    // 地区过滤 (Region Filter) - 在本地做
    const finalResults = items.filter(item => {
        if (dailyRegionFilter === "all") return true;
        const countries = item.tmdb_origin_countries || [];
        if (dailyRegionFilter === "JP") return countries.includes("JP");
        if (dailyRegionFilter === "CN") return countries.includes("CN");
        return false;
    });
    
    // 最终确认 (Double check)
    return finalResults.filter(item => item.backdropPath && item.genre_ids);
}
