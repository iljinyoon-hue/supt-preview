// 울산항 공공데이터 집계 규칙(브라우저·Node 공용, 외부 패키지 없음)
// 1) 울산항 지금  : 항내 선박위치정보(VslPstnInfoService/getVslPstnInfo) 전체 목록
// 2) 벌크 화물 동향: 수출입 화물정보(IntgCagInfoService/getIntgCagInfo) 입항연도별 전체 B/L
/* eslint-disable */
var UPA_AGG = (function () {
  // 울산항 항계(대략): 본항·온산·미포·신항·정박지 포함
  var BOX = { lon0: 129.33, lon1: 129.48, lat0: 35.40, lat1: 35.56 };
  var FRESH_H = 3;                                    // 최근 3시간 안에 위치가 갱신된 선박만
  function tm(s) { s = String(s || ''); return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10) - 9, +s.slice(10, 12), +s.slice(12, 14) || 0); }

  function portNow(rows, nowMs) {
    var inPort = 0, berthed = 0, anchored = 0, latest = 0;
    rows.forEach(function (r) { var t = tm(r.updtTm); if (t > latest) latest = t; });
    var ref = Math.min(nowMs || latest, latest || nowMs);
    rows.forEach(function (r) {
      var lo = +r.lot, la = +r.lat, t = tm(r.updtTm);
      if (!r.ptentYr || !lo || !la) return;                           // 입항 신고 선박만
      if (lo < BOX.lon0 || lo > BOX.lon1 || la < BOX.lat0 || la > BOX.lat1) return;
      if (ref - t > FRESH_H * 3600e3) return;
      inPort++;
      var st = String(r.nvgtStts || '');
      if (st.indexOf('계류') >= 0) berthed++;
      else if (st.indexOf('앵커') >= 0) anchored++;
    });
    return { inPort: inPort, berthed: berthed, anchored: anchored, positionsAt: latest ? new Date(latest).toISOString() : null };
  }

  // 품목 묶음(HS 2단위). 액체·가스·컨테이너·자동차는 선박 유형에서 이미 제외
  var GROUPS = [
    ['광석·정광', 'Ores & concentrates', ['26']],
    ['석탄·코크스', 'Coal & coke', ['27']],
    ['곡물', 'Grain', ['10', '11', '12']],
    ['사료', 'Animal feed', ['23']],
    ['소금·규사', 'Salt & sand', ['25', '68']],
    ['목재·우드칩', 'Timber & wood chips', ['44']],
    ['비료', 'Fertiliser', ['31']],
    ['화학제품', 'Chemicals', ['28', '29', '38', '39']],
    ['펄프·종이', 'Pulp & paper', ['47', '48']],
    ['철강', 'Steel', ['72', '73']],
    ['비철금속', 'Non-ferrous metals', ['74', '75', '76', '78', '79', '80', '81']],
    ['설탕', 'Sugar', ['17']],
    ['기계·설비', 'Machinery & equipment', ['84', '85', '86', '87', '88', '89']],
  ];
  var OTHER = ['기타', 'Others'];
  var BULK_VESSELS = ['산물선', '벌크선', '일반화물선'];
  function groupOf(code) {
    var h = String(code || '').slice(0, 2);
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][2].indexOf(h) >= 0) return i;
    return -1;
  }
  // records: 수출입 화물정보 item 배열(여러 해 합친 것), nowMs: 기준 시각
  // 최근 13개월 = 기준 시각이 속한 달의 전달까지(월간 자료라 이번 달은 제외)
  function bulkTrend(records, nowMs) {
    var k = new Date((nowMs || Date.now()) + 9 * 3600e3);
    var months = [];
    for (var i = 13; i >= 1; i--) { var d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - i, 1)); months.push(d.toISOString().slice(0, 7)); }
    var idx = {}; months.forEach(function (m, i) { idx[m.replace('-', '')] = i; });
    var z = function () { return months.map(function () { return 0; }); };
    var items = GROUPS.map(function (g) { return { ko: g[0], en: g[1], all: z(), imp: z(), exp: z() }; });
    items.push({ ko: OTHER[0], en: OTHER[1], all: z(), imp: z(), exp: z() });
    var used = 0;
    records.forEach(function (r) {
      var vt = String(r.vslTypeNm || '');
      if (!BULK_VESSELS.some(function (w) { return vt.indexOf(w) >= 0; })) return;
      var i = idx[String(r.ptentDt || '').slice(0, 6)]; if (i === undefined) return;
      var t = parseFloat(r.wghtTon); if (!(t > 0)) return;
      var g = groupOf(r.cagItemCd), it = items[g < 0 ? items.length - 1 : g], io = String(r.ioSeNm || '');
      it.all[i] += t; used++;
      if (io.indexOf('수입') >= 0) it.imp[i] += t; else if (io.indexOf('수출') >= 0) it.exp[i] += t;
    });
    items.forEach(function (it) { ['all', 'imp', 'exp'].forEach(function (s) { it[s] = it[s].map(Math.round); }); });
    var total = {}; ['all', 'imp', 'exp'].forEach(function (s) { total[s] = months.map(function (_, i) { return items.reduce(function (a, it) { return a + it[s][i]; }, 0); }); });
    items = items.filter(function (it) { return it.all.some(function (v) { return v > 0; }); });
    return { unit: 't', latest: months[months.length - 1], months: months, total: total, items: items, records: used };
  }
  return { portNow: portNow, bulkTrend: bulkTrend, BOX: BOX };
})();
if (typeof module !== 'undefined') module.exports = UPA_AGG;
