/**
 * 世界杯预测引擎 v2
 * 基于 AJAX 赔率接口真实数据的规则打分系统
 * 
 * 核心思路：
 * 1. 盘口深度 = 机构对实力差距的判断（绝对值越大信心越强）
 * 2. 水位 = 机构赔付意愿（低水控赔 = 看好，高水 = 诱盘或风险）
 * 3. 多家公司共识 = 信号可靠性
 * 4. 欧赔+亚盘+大小球 三维交叉验证
 */

const PredictEngine = {

  // 参考公司优先级
  REF_COMPANIES: [1, 3, 9],  // 澳门, Crown, 立博

  predict(match) {
    const odds = match.odds || {};
    const asian = odds.asian || [];
    const overUnder = odds.overUnder || [];
    const euro1x2 = odds.euro1x2 || [];

    // 获取多家公司的核心数据
    const hc = this._getMultiCompany(asian, this.REF_COMPANIES);
    const ou = this._getMultiCompany(overUnder, this.REF_COMPANIES);
    const eu = this._getMultiCompany(euro1x2, [545, 80, 1]); // 欧赔公司

    const handicap = this._analyzeHandicap(hc);
    const overUnderResult = this._analyzeOverUnder(ou);
    const euroResult = this._analyzeEuro(eu, handicap);
    const score = this._predictScore(handicap, overUnderResult);

    return {
      matchId: match.id,
      homeName: match.homeName,
      awayName: match.awayName,
      datetime: match.datetime,
      handicap,
      overUnder: overUnderResult,
      euro1x2: euroResult,
      score,
      summary: this._makeSummary(handicap, overUnderResult, euroResult, score),
    };
  },

  // ========== 多公司数据聚合 ==========
  _getMultiCompany(oddsList, companyIds) {
    const result = [];
    for (const cid of companyIds) {
      const entry = oddsList.find(o => o.companyId === cid);
      if (entry) result.push(entry);
    }
    return result;
  },

  _median(arr) {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },

  // ========== 亚盘分析（核心） ==========
  _analyzeHandicap(companies) {
    if (!companies.length) {
      return { direction: null, confidence: 0, reason: '赔率数据不足' };
    }

    // 提取各公司数据
    const handicaps = companies.map(c => c.handicap);
    const homeWaters = companies.map(c => c.homeWater);
    const awayWaters = companies.map(c => c.awayWater);
    const names = companies.map(c => c.companyName);

    const medHcap = this._median(handicaps);
    const medHomeWater = this._median(homeWaters);
    const medAwayWater = this._median(awayWaters);

    // 公司一致性（方差异常检测）
    const hcapSpread = Math.max(...handicaps) - Math.min(...handicaps);
    const consensus = hcapSpread <= 0.25 ? 'high' : hcapSpread <= 0.5 ? 'medium' : 'low';

    let direction = null; // 'home' | 'away' | 'draw'
    let confidence = 0;
    const reasons = [];

    // === 1. 盘口深度分析 ===
    if (medHcap >= 1.25) {
      direction = 'home';
      confidence += 35;
      reasons.push(`主让${this._fmtHcap(medHcap)}深盘，机构强烈看好主队`);
    } else if (medHcap >= 0.75) {
      direction = 'home';
      confidence += 25;
      reasons.push(`主让${this._fmtHcap(medHcap)}，机构看好主队`);
    } else if (medHcap >= 0.25) {
      direction = 'home';
      confidence += 15;
      reasons.push(`主让${this._fmtHcap(medHcap)}浅盘，主队略占优`);
    } else if (medHcap <= -1.25) {
      direction = 'away';
      confidence += 35;
      reasons.push(`客让${this._fmtHcap(-medHcap)}深盘，机构强烈看好客队`);
    } else if (medHcap <= -0.75) {
      direction = 'away';
      confidence += 25;
      reasons.push(`客让${this._fmtHcap(-medHcap)}，机构看好客队`);
    } else if (medHcap <= -0.25) {
      direction = 'away';
      confidence += 15;
      reasons.push(`客让${this._fmtHcap(-medHcap)}浅盘，客队略占优`);
    } else {
      // 平手盘
      direction = null; // 待定
      reasons.push('平手盘，双方实力接近');
    }

    // === 2. 水位分析 ===
    const waterGap = medHomeWater - medAwayWater;
    
    if (direction === 'home' && medHomeWater < 0.90) {
      confidence += 15;
      reasons.push(`主水低至${medHomeWater}，机构控赔看好(${names.join('/')}一致)`);
    } else if (direction === 'away' && medAwayWater < 0.90) {
      confidence += 15;
      reasons.push(`客水低至${medAwayWater}，机构控赔看好(${names.join('/')}一致)`);
    } else if (medHcap === 0) {
      // 平手盘看水位偏向
      if (medHomeWater < medAwayWater - 0.1) {
        direction = 'home';
        confidence += 12;
        reasons.push(`平手盘主水(${medHomeWater})低于客水(${medAwayWater})，倾向主队`);
      } else if (medAwayWater < medHomeWater - 0.1) {
        direction = 'away';
        confidence += 12;
        reasons.push(`平手盘客水(${medAwayWater})低于主水(${medHomeWater})，倾向客队`);
      }
    }

    // 平手盘且无水位偏向 → 平局可能
    if (!direction && medHcap === 0) {
      direction = 'draw';
      confidence += 5;
      reasons.push('平手盘水位均衡，平局可能性大');
    }

    // === 3. 一致性加分 ===
    if (consensus === 'high') {
      confidence += 10;
      reasons.push(`${companies.length}家公司盘口一致(均${this._fmtHcap(medHcap)})，信号可靠`);
    } else if (consensus === 'low') {
      confidence -= 15;
      reasons.push(`⚠️ 公司间盘口分歧大(${this._fmtHcap(handicaps[0])}~${this._fmtHcap(handicaps[handicaps.length - 1])})`);
    }

    // === 4. 诱盘检测 ===
    if (direction === 'home' && medHomeWater > 1.05 && medHcap >= 0.75) {
      confidence -= 20;
      reasons.push('⚠️ 深盘+高水，注意诱上风险');
    } else if (direction === 'away' && medAwayWater > 1.05 && Math.abs(medHcap) >= 0.75) {
      confidence -= 20;
      reasons.push('⚠️ 深盘+高水，注意诱上风险');
    }

    confidence = Math.max(0, Math.min(100, confidence));

    return {
      direction,
      confidence,
      handicap: medHcap,
      homeWater: medHomeWater,
      awayWater: medAwayWater,
      consensus,
      companies: companies.map(c => ({
        name: c.companyName,
        handicap: c.handicap,
        homeWater: c.homeWater,
        awayWater: c.awayWater,
      })),
      reasons,
      suggestion: this._handicapSuggestion(direction, medHcap, confidence),
    };
  },

  _handicapSuggestion(direction, handicap, confidence) {
    if (confidence < 15) return '信号不明确，建议观望';
    const abs = Math.abs(handicap);
    const hcapText = handicap === 0 ? '平手' : this._fmtHcap(handicap);

    if (direction === 'home') {
      return handicap <= 0
        ? `客队让${this._fmtHcap(abs)}，推主队(受让)`
        : `主队让${hcapText}，推主队`;
    } else if (direction === 'away') {
      return handicap >= 0
        ? `主队让${hcapText}，推客队(受让)`
        : `客队让${this._fmtHcap(abs)}，推客队`;
    }
    return '平手盘，建议观望';
  },

  // ========== 大小球分析 ==========
  _analyzeOverUnder(companies) {
    if (!companies.length) {
      return { direction: null, confidence: 0, reason: '数据不足' };
    }

    const totals = companies.map(c => c.total);
    const overWaters = companies.map(c => c.overWater);
    const underWaters = companies.map(c => c.underWater);
    const names = companies.map(c => c.companyName);

    const medTotal = this._median(totals);
    const medOverWater = this._median(overWaters);
    const medUnderWater = this._median(underWaters);

    let direction = null;  // 'over' | 'under'
    let confidence = 0;
    const reasons = [];

    // === 1. 盘口深度 ===
    if (medTotal >= 3.25) {
      direction = 'over';
      confidence += 30;
      reasons.push(`大小球盘口${medTotal}球，属于高线，机构预期进球多`);
    } else if (medTotal >= 2.75) {
      direction = 'over';
      confidence += 15;
      reasons.push(`大小球盘口${medTotal}球，偏大球方向`);
    } else if (medTotal <= 2.0) {
      direction = 'under';
      confidence += 30;
      reasons.push(`大小球盘口${medTotal}球，属于低线，机构预期进球少`);
    } else if (medTotal <= 2.25) {
      direction = 'under';
      confidence += 15;
      reasons.push(`大小球盘口${medTotal}球，偏小球方向`);
    } else {
      // 2.25-2.5 属于常见范围，看水位
      reasons.push(`大小球盘口${medTotal}球，属于常见范围`);
    }

    // === 2. 水位分析 ===
    const waterGap = medOverWater - medUnderWater;

    if (medOverWater < 0.85 && medOverWater < medUnderWater) {
      if (!direction || direction === 'over') {
        direction = 'over';
        confidence += 12;
        reasons.push(`大球低水(${medOverWater})，机构防范大球打出`);
      }
    } else if (medUnderWater < 0.85 && medUnderWater < medOverWater) {
      if (!direction || direction === 'under') {
        direction = 'under';
        confidence += 12;
        reasons.push(`小球低水(${medUnderWater})，机构防范小球打出`);
      }
    }

    // === 3. 如果仍无方向 ===
    if (!direction) {
      direction = medTotal >= 2.5 ? 'over' : 'under';
      confidence += 5;
      reasons.push(`基于盘口${medTotal}球默认判断`);
    }

    // === 4. 一致性 ===
    const totalSpread = Math.max(...totals) - Math.min(...totals);
    if (totalSpread <= 0.25) {
      confidence += 8;
      reasons.push(`${companies.length}家公司大小球一致，信号可靠`);
    } else if (totalSpread >= 0.75) {
      confidence -= 10;
      reasons.push(`⚠️ 大小球公司间分歧较大`);
    }

    confidence = Math.max(0, Math.min(100, confidence));

    return {
      direction,
      confidence,
      total: medTotal,
      overWater: medOverWater,
      underWater: medUnderWater,
      companies: companies.map(c => ({
        name: c.companyName,
        total: c.total,
        overWater: c.overWater,
        underWater: c.underWater,
      })),
      reasons,
      suggestion: direction === 'over'
        ? `推荐大球(${medTotal}球)`
        : `推荐小球(${medTotal}球)`,
    };
  },

  // ========== 欧赔分析 ==========
  _analyzeEuro(companies, handicapResult) {
    if (!companies.length) {
      return { direction: null, confidence: 0, reason: '数据不足' };
    }

    const wins = companies.map(c => c.win);
    const draws = companies.map(c => c.draw);
    const loses = companies.map(c => c.lose);

    const medWin = this._median(wins);
    const medDraw = this._median(draws);
    const medLose = this._median(loses);

    let direction = null;
    let confidence = 0;
    const reasons = [];

    // 最低赔率方向
    const lowest = Math.min(medWin, medDraw, medLose);

    if (medWin === lowest && medWin < 1.80) {
      direction = 'home';
      confidence += 25;
      reasons.push(`主胜中位赔率${medWin}为最低，机构看好主胜`);
    } else if (medLose === lowest && medLose < 1.80) {
      direction = 'away';
      confidence += 25;
      reasons.push(`客胜中位赔率${medLose}为最低，机构看好客胜`);
    } else if (medDraw < 3.50 && Math.abs(medWin - medLose) < 0.50) {
      direction = 'draw';
      confidence += 18;
      reasons.push(`胜平负赔率接近，平赔${medDraw}，平局可能大`);
    } else if (medWin < medLose) {
      direction = 'home';
      confidence += 10;
      reasons.push(`主胜(${medWin}) < 客胜(${medLose})，主队占优`);
    } else {
      direction = 'away';
      confidence += 10;
      reasons.push(`客胜(${medLose}) < 主胜(${medWin})，客队占优`);
    }

    // 交叉验证（欧赔 vs 亚盘）
    const hcDir = handicapResult.direction;
    if (hcDir && hcDir === direction) {
      confidence += 10;
      reasons.push('✓ 欧赔与亚盘方向一致，信号加强');
    } else if (hcDir && hcDir !== direction && direction !== 'draw') {
      confidence -= 10;
      reasons.push('⚠️ 欧赔与亚盘方向矛盾，信号弱化');
    }

    confidence = Math.max(0, Math.min(100, confidence));

    return {
      direction,
      confidence,
      win: medWin,
      draw: medDraw,
      lose: medLose,
      companies: companies.map(c => ({
        name: c.companyName,
        win: c.win,
        draw: c.draw,
        lose: c.lose,
      })),
      reasons,
      suggestion: this._euroSuggestion(direction, { win: medWin, draw: medDraw, lose: medLose }),
    };
  },

  _euroSuggestion(direction, refEuro) {
    const m = { home: '主胜', draw: '平局', away: '客胜' };
    return `推荐${m[direction] || '观望'}`;
  },

  // ========== 比分预测 ==========
  _predictScore(handicap, overUnder) {
    const hcap = handicap.handicap;
    const ouTotal = overUnder.total;

    if (hcap === null || ouTotal === null) {
      return { scores: [], confidence: 0, reason: '数据不足' };
    }

    // 盘口深度 → 预期进球差
    let expectedDiff = 0;
    if (hcap >= 1.5) expectedDiff = 2;
    else if (hcap >= 0.75) expectedDiff = 1;
    else if (hcap >= 0.25) expectedDiff = 0.5;
    else if (hcap <= -1.5) expectedDiff = -2;
    else if (hcap <= -0.75) expectedDiff = -1;
    else if (hcap <= -0.25) expectedDiff = -0.5;

    const totalGoals = Math.round(ouTotal);

    const scores = [];
    for (let home = 0; home <= 5; home++) {
      for (let away = 0; away <= 5; away++) {
        const diff = home - away;
        const total = home + away;
        if (Math.abs(diff - expectedDiff) <= 1 &&
            Math.abs(total - totalGoals) <= 1 &&
            total <= 5 && home <= 4 && away <= 4) {
          scores.push(`${home}:${away}`);
        }
      }
    }

    scores.sort((a, b) => {
      const [h1, a1] = a.split(':').map(Number);
      const [h2, a2] = b.split(':').map(Number);
      const d1 = Math.abs((h1 - a1) - expectedDiff) + Math.abs((h1 + a1) - ouTotal);
      const d2 = Math.abs((h2 - a2) - expectedDiff) + Math.abs((h2 + a2) - ouTotal);
      return d1 - d2;
    });

    return {
      scores: scores.slice(0, 5),
      confidence: Math.min(60, scores.length * 10),
      expectedDiff,
      expectedTotal: ouTotal,
      reason: `盘口${this._fmtHcap(hcap)}→进球差约${expectedDiff > 0 ? '+' + expectedDiff : expectedDiff}球，大小球${ouTotal}球`,
    };
  },

  // ========== 综合 ==========
  _makeSummary(h, ou, eu, sc) {
    const parts = [];
    if (h.direction && h.confidence >= 20) parts.push(h.suggestion);
    if (ou.direction && ou.confidence >= 20) parts.push(ou.suggestion);
    if (eu.direction && eu.confidence >= 20) parts.push(eu.suggestion);
    if (sc.scores && sc.scores.length) parts.push(`比分参考：${sc.scores.slice(0, 3).join(' / ')}`);
    return parts.join('；') || '数据不足，暂无建议';
  },

  // ========== 工具函数 ==========
  _fmtHcap(val) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    if (val === 0) return '平手';
    const abs = Math.abs(val);
    const prefix = val > 0 ? '' : '客让';
    const map = {
      0.25: `${prefix}平/半`, 0.5: `${prefix}半球`, 0.75: `${prefix}半/一`,
      1.0: `${prefix}一球`, 1.25: `${prefix}一/球半`, 1.5: `${prefix}球半`,
      1.75: `${prefix}球半/两`, 2.0: `${prefix}两球`,
    };
    return map[abs] || `${prefix}${abs}`;
  },

  predictAll(matches) {
    return matches.filter(m => m.round === 0).map(m => this.predict(m));
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PredictEngine;
}
