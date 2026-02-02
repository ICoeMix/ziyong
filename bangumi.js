// --- 核心配置 ---
const BASE_DATA_URL = "https://forward.mobio.workers.dev";
const RECENT_DATA_URL = `${BASE_DATA_URL}/data/bangumi_recent_hot_processed.json`;

// --- 动态年份生成 ---
const currentYear = new Date().getFullYear();
const startYear = 2025; 
const yearOptions = [];
for (let year = currentYear; year >= 1940; year--) { 
    yearOptions.push({ title: `${year}`, value: `${year}` });
}

var WidgetMetadata = {
    id: "bangumi-tmdb_v3",
    title: "Bangumi 热门榜单",
    description: "获取Bangumi热门及每日放送，强制过滤无横版封面(Backdrop)的内容，补全分类ID。",
    version: "3.2.0",
    author: "ICoeMix(Optimized by ChatGPT)",
    site: "https://github.com/ICoeMix/Forward-Widget",
    requiredVersion: "0.0.1",
    detailCacheDuration: 6000,
    modules: [
        {
            title: "近期热门",
            description: "按作品类型浏览近期热门 (需有横版封面)",
            requiresWebView: false,
            functionName: "fetchRecentHot",
            cacheDuration: 500000,
            params: [
                { name: "category", title: "分类", type: "enumeration", value: "anime", enumOptions: [ { title: "动画", value: "anime" } ] },
                { name: "pages", title: "页码范围", type: "input", value: "1", description: "如 1 或 1-3" },
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
            description: "查看每日更新 (需有横版封面)",
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

// 获取并缓存全局数据 (保持不变)
async function fetchAndCacheGlobalData() {
    if (globalData) return globalData;
    if (dataFetchPromise) return await dataFetchPromise;
    dataFetchPromise = (async () => {
        try {
            const response = await Widget.http.get(RECENT_DATA_URL, { headers: { 'Cache-Control': 'no-cache' } });
            globalData = response.data;
            globalData.dynamic = {};
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
        static MAX_CONCURRENT_DETAILS_FETCH = 8; 
        static tmdbCache = new Map(); 

        static normalizeTmdbQuery(query) { 
            if (!query || typeof query !== 'string') return ""; 
            return query.toLowerCase().trim()
                .replace(/[\[\]【】（）()「」『』:：\-－_,\.・]/g, ' ')
                .replace(/\s+/g, ' ').trim();
        }

        static parseDate(dateStr) { 
            // 简单的日期解析
            if (!dateStr) return '';
            let match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/); 
            if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
            match = dateStr.match(/(\d{4})年(\d{1,2})月/);
            if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-01`;
            match = dateStr.match(/(\d{4})/);
            if (match) return `${match[1]}-01-01`;
            return '';
        }

        // TMDB 搜索评分算法
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

        // TMDB 搜索函数
        static async searchTmdb(originalTitle, chineseTitle, year) {
            const cacheKey = `${originalTitle}-${chineseTitle}-${year}`;
            if (Processor.tmdbCache.has(cacheKey)) return Processor.tmdbCache.get(cacheKey);

            let bestMatch = null;
            let maxScore = -1;
            const query = chineseTitle || originalTitle;
            
            try {
                // 优先搜 TV
                const response = await Widget.tmdb.get(`/search/tv`, { 
                    params: { query, language: "zh-CN", include_adult: false, first_air_date_year: year } 
                });
                
                const results = response?.results || [];
                for (const result of results) {
                    // 必须包含动画分类 (16)
                    if (result.genre_ids && !result.genre_ids.includes(Processor.TMDB_ANIMATION_GENRE_ID)) continue;
                    
                    const score = Processor.scoreTmdbResult(result, query, year);
                    if (score > maxScore) {
                        maxScore = score;
                        bestMatch = result;
                    }
                }
            } catch (err) { console.error(err); }

            Processor.tmdbCache.set(cacheKey, bestMatch);
            return bestMatch;
        }

        // 详情获取与合并 (核心修改处)
        static async fetchItemDetails(item, category) {
            const yearMatch = item.info.match(/(\d{4})/);
            const year = yearMatch ? yearMatch[1] : '';
            
            // 基础对象 (Bangumi 数据)
            const baseItem = {
                id: item.id, 
                type: "link", 
                title: item.title,
                posterPath: item.cover, // 初始为 Bangumi 竖版封面
                backdropPath: null,     // Bangumi 通常没有横版
                releaseDate: Processor.parseDate(item.info),
                mediaType: category, 
                rating: item.rating,
                description: item.info, 
                link: `${Processor.BGM_BASE_URL}/subject/${item.id}`,
                genre_ids: [] // 初始化为空，等待 TMDB 填充
            };

            // 必须查询 TMDB (为了获取 genre_ids 和 backdropPath)
            const tmdbResult = await Processor.searchTmdb(item.title, null, year);
            
            if (tmdbResult) {
                baseItem.id = String(tmdbResult.id);
                baseItem.type = "tmdb";
                baseItem.title = tmdbResult.name || tmdbResult.title || baseItem.title;
                
                // 设置图片
                baseItem.posterPath = tmdbResult.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbResult.poster_path}` : baseItem.posterPath;
                baseItem.backdropPath = tmdbResult.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbResult.backdrop_path}` : null;
                
                // 设置其他元数据
                baseItem.releaseDate = tmdbResult.first_air_date || tmdbResult.release_date || baseItem.releaseDate;
                baseItem.rating = tmdbResult.vote_average ? tmdbResult.vote_average.toFixed(1) : baseItem.rating;
                baseItem.description = tmdbResult.overview || baseItem.description;
                baseItem.link = null; // 转为 tmdb 类型后 link 置空
                baseItem.tmdb_id = String(tmdbResult.id);
                baseItem.tmdb_origin_countries = tmdbResult.origin_country || [];
                
                // --- 关键修正：确保 genre_ids 被赋值 ---
                baseItem.genre_ids = tmdbResult.genre_ids || []; 
            }

            // --- 核心过滤逻辑 ---
            // 规则：查询完 TMDB 后，如果没有 backdropPath (横版)，则丢弃。
            if (!baseItem.backdropPath) {
                // 也可以加一个判断：如果 posterPath 也没有，肯定丢弃。
                // 如果 posterPath 有但 backdropPath 没有，根据你的要求也是丢弃。
                return null;
            }

            return baseItem;
        }

        // Bangumi 网页解析
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
                // 并发获取详情并过滤
                for (let i = 0; i < pendingItems.length; i += Processor.MAX_CONCURRENT_DETAILS_FETCH) {
                    const batch = pendingItems.slice(i, i + Processor.MAX_CONCURRENT_DETAILS_FETCH);
                    const promises = batch.map(item => Processor.fetchItemDetails(item, category));
                    const settled = await Promise.allSettled(promises);
                    settled.forEach(res => {
                        // 过滤掉返回 null 的项目 (即没有横版封面的)
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

        // 每日放送逻辑
        static async processDailyCalendar() {
            try {
                const apiResponse = await Widget.http.get("https://api.bgm.tv/calendar");
                const allItems = [];
                apiResponse.data.forEach(dayData => {
                    if (dayData.items) {
                        dayData.items.forEach(item => {
                            item.bgm_weekday_id = dayData.weekday?.id;
                            allItems.push(item);
                        });
                    }
                });

                const enhancedItems = [];
                for (let i = 0; i < allItems.length; i += Processor.MAX_CONCURRENT_DETAILS_FETCH) {
                    const batch = allItems.slice(i, i + Processor.MAX_CONCURRENT_DETAILS_FETCH);
                    const promises = batch.map(async (item) => {
                        const baseItem = {
                            id: String(item.id), 
                            type: "link", 
                            title: item.name_cn || item.name,
                            posterPath: item.images?.large?.startsWith('//') ? 'https:' + item.images.large : item.images?.large,
                            backdropPath: null, // 初始化无横图
                            releaseDate: item.air_date, 
                            mediaType: 'anime', 
                            rating: item.rating?.score?.toFixed(1) || "N/A",
                            description: item.summary || '',
                            link: item.url, 
                            bgm_id: String(item.id), 
                            bgm_score: item.rating?.score || 0,
                            bgm_rating_total: item.rating?.total || 0, 
                            bgm_weekday_id: item.bgm_weekday_id,
                            genre_ids: [] // 初始化
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
                            // --- 补全 genre_ids ---
                            baseItem.genre_ids = tmdbResult.genre_ids || [];
                        }

                        // --- 核心过滤：必须有 backdropPath (横版) ---
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
        searchTmdb: Processor.searchTmdb // 暴露给主函数用
    };
})();

// ==================== 模块函数 ====================

// 1. 近期热门
async function fetchRecentHot(params = {}) {
    // 1️⃣ 确保全局数据已加载
    await fetchAndCacheGlobalData();

    const category = params.category || "anime";
    const sort = params.sort || "default";

    // 2️⃣ 解析页码参数（支持 1 / 1-3）
    let pageList = [];
    const pageInput = params.pages || "1";

    if (pageInput.includes("-")) {
        const [start, end] = pageInput.split("-").map(n => parseInt(n, 10));
        for (let i = start; i <= end; i++) {
            if (!isNaN(i)) pageList.push(i);
        }
    } else {
        const p = parseInt(pageInput, 10);
        if (!isNaN(p)) pageList.push(p);
    }

    // 3️⃣ 从 GitHub 处理后的 recentHot 数据中取页
    const pages = globalData.recentHot?.[category] || [];
    let resultList = [];

    for (const p of pageList) {
        if (pages[p - 1] && Array.isArray(pages[p - 1])) {
            resultList = resultList.concat(pages[p - 1]);
        }
    }

    // 4️⃣ 核心逻辑：只保留有横版 backdrop 的项（不再二次 TMDB 处理）
    let processedList = resultList.filter(item => item && item.backdropPath);

    // 5️⃣ 排序逻辑
    if (sort === "date") {
        processedList.sort((a, b) => {
            return new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0);
        });
    } else if (sort === "score") {
        processedList.sort((a, b) => {
            return (b.rating || 0) - (a.rating || 0);
        });
    }
    // sort === "default"：保持原顺序（即 GitHub 产出顺序）

    // 6️⃣ 返回最终结果
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
    
    // 动态模式
    const dynamicKey = `airtime-${category}-${year}-${month}-${sort}-${page}`;
    if (globalData.dynamic[dynamicKey]) return globalData.dynamic[dynamicKey];

    const url = `https://bgm.tv/${category}/browser/airtime/${year}/${month}?sort=${sort}&page=${page}`;
    
    // 核心调用：Processor 内部已经实现了 "无 backdropPath 则返回 null"
    const listItems = await DynamicDataProcessor.processBangumiPage(url, category);
    
    globalData.dynamic[dynamicKey] = listItems;
    return listItems;
}

// 3. 每日放送
async function fetchDailyCalendarApi(params = {}) {
    await fetchAndCacheGlobalData();
    
    // 检查缓存或动态获取
    let items = globalData.dailyCalendar?.all_week || [];
    if (!items.length && !archiveFetchPromises['daily']) {
        // 这里调用的 processDailyCalendar 已经包含了 "无 backdrop 丢弃" 和 "补全 genre_ids"
        const dynamicItems = await DynamicDataProcessor.processDailyCalendar();
        if (!globalData.dailyCalendar) globalData.dailyCalendar = {};
        globalData.dailyCalendar.all_week = dynamicItems;
        items = dynamicItems;
    }

    const { filterType = "today", specificWeekday = "1", dailyRegionFilter = "all" } = params;
    const JS_DAY_TO_BGM_API_ID = {0:7,1:1,2:2,3:3,4:4,5:5,6:6};
    
    // 星期过滤
    let filteredByDay = [];
    if (filterType === "all_week") filteredByDay = items;
    else {
        const today = new Date();
        const targetBgmIds = new Set();
        switch (filterType) {
            case "today": targetBgmIds.add(JS_DAY_TO_BGM_API_ID[today.getDay()]); break;
            case "specific_day": targetBgmIds.add(parseInt(specificWeekday,10)); break;
            case "mon_thu": [1,2,3,4].forEach(id=>targetBgmIds.add(id)); break;
            case "fri_sun": [5,6,7].forEach(id=>targetBgmIds.add(id)); break;
        }
        filteredByDay = items.filter(item => item.bgm_weekday_id && targetBgmIds.has(item.bgm_weekday_id));
    }

    // 地区过滤
    const finalResults = filteredByDay.filter(item => {
        if (dailyRegionFilter === "all") return true;
        const countries = item.tmdb_origin_countries || [];
        if (dailyRegionFilter === "JP") return countries.includes("JP");
        if (dailyRegionFilter === "CN") return countries.includes("CN");
        return false;
    });
    
    // 最终安全检查：再次过滤掉没有 backdropPath 的 (以防缓存数据有问题)
    return finalResults.filter(item => item.backdropPath);
}
