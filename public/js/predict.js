/**
 * 世界杯预测引擎 — Predict Engine
 * 基于盘口/赔率数据的规则打分系统
 * 
 * 核心思路：机构的信息优势 > 普通球迷，"跟着盘口走"
 * 通过初盘→即时盘的变化趋势 + 水位变化 + 多维度交叉验证来判断机构真实意图
 */

const PredictEngine = {

  /**
   * 对一场比赛进行完整预测
   * @param {Object} match - 比赛数据（含odds）
   * @returns {Object} 预测结果
   */
  predict(match) {
    const odds = match.odds || {};
    const asian = odds.asian || [];
    const overUnder = odds.overUnder || [];
    const euro1x2 = odds.euro1x2 || [];

    // 获取参考公司的赔率（优先Crown=3，其次澳门=1）
    const refAsian = this._findCompany(asian, 3) || this._findCompany(asian, 1);
    const refOU = this._findCompany(overUnder, 3) || this._findCompany(overUnder, 1);
    const refEuro = this._findCompany(euro1x2, 545) || this._findCompany(euro1x2, 80); // Crown欧赔=545, 澳*=80

    // 盘口变化分析
    const initHcap = parseFloat(match.initHandicap);
    const liveHcap = parseFloat(match.liveHandicap);

    // 1. 盘口建议
    const handicapAdvice = this._analyzeHandicap(match, refAsian, initHcap, liveHcap);

    // 2. 大小球建议
    const ouAdvice = this._analyzeOverUnder(match, refOU);

    // 3. 胜平负建议
    const euroAdvice = this._analyzeEuro(match, refEuro, refAsian, initHcap, liveHcap);

    // 4. 比分建议
    const scoreAdvice = this._predictScore(match, refAsian, refOU, handicapAdvice, ouAdvice);

    return {
      matchId: match.id,
      homeName: match.homeName,
      awayName: match.awayName,
      datetime: match.datetime,
      handicap: handicapAdvice,
      overUnder: ouAdvice,
      euro1x2: euroAdvice,
      score: scoreAdvice,
      summary: this._makeSummary(handicapAdvice, ouAdvice, euroAdvice, scoreAdvice),
    };
  },

  // ========== 亚盘分析 ==========
  _analyzeHandicap(match, refAsian, initHcap, liveHcap) {
    if (isNaN(initHcap) || isNaN(liveHcap)) {
      return { direction: null, confidence: 0, reason: '数据不足' };
    }

    const hcapChange = liveHcap - initHcap; // 正=升盘, 负=降盘
    const homeWater = refAsian ? refAsian.homeWater : null;
    const awayWater = refAsian ? refAsian.awayWater : null;

    let direction = null;  // 'home' | 'away' | 'draw'
    let confidence = 0;
    const reasons = [];

    // 盘口变化分析
    if (hcapChange > 0.3) {
      // 升盘较多 → 机构看好主队
      direction = 'home';
      confidence += 35;
      reasons.push(`盘口从${this._fmtHcap(initHcap)}升至${this._fmtHcap(liveHcap)}，机构追加主队信心`);
    } else if (hcapChange > 0) {
      direction = 'home';
      confidence += 20;
      reasons.push(`盘口从${this._fmtHcap(initHcap)}微升至${this._fmtHcap(liveHcap)}，略倾向主队`);
    } else if (hcapChange < -0.3) {
      direction = 'away';
      confidence += 35;
      reasons.push(`盘口从${this._fmtHcap(initHcap)}降至${this._fmtHcap(liveHcap)}，机构减弱主队信心`);
    } else if (hcapChange < 0) {
      direction = 'away';
      confidence += 15;
      reasons.push(`盘口从${this._fmtHcap(initHcap)}微降至${this._fmtHcap(liveHcap)}，略倾向客队`);
    } else {
      // 盘口不变 → 看水位
      if (homeWater !== null && awayWater !== null) {
        if (homeWater < 0.88) {
          direction = 'home';
          confidence += 15;
          reasons.push(`盘口不变，主队低水(${homeWater})，机构控赔看好主队`);
        } else if (awayWater < 0.88) {
          direction = 'away';
          confidence += 15;
          reasons.push(`盘口不变，客队低水(${awayWater})，机构控赔看好客队`);
        } else {
          direction = 'home';
          confidence += 5;
          reasons.push('盘口水位均衡，略微倾向主队');
        }
      }
    }

    // 水位辅助判断
    if (homeWater !== null && awayWater !== null && hcapChange !== 0) {
      if (direction === 'home' && homeWater < 0.90) {
        confidence += 10;
        reasons.push('升盘配合低水，信号加强');
      } else if (direction === 'away' && awayWater < 0.90) {
        confidence += 10;
        reasons.push('降盘配合低水，信号加强');
      }
      // 如果盘口升但主队高水 → 诱盘嫌疑
      if (direction === 'home' && homeWater > 1.0) {
        confidence -= 15;
        reasons.push('注意：升盘但高水，可能有诱盘嫌疑');
      }
    }

    // 盘口深度判断
    if (Math.abs(liveHcap) >= 2.0) {
      reasons.push('深盘，实力差距大');
      confidence += 5;
    } else if (Math.abs(liveHcap) <= 0.25) {
      reasons.push('平手盘，双方实力接近');
    }

    confidence = Math.max(0, Math.min(100, confidence));

    return {
      direction,
      confidence,
      initHandicap: initHcap,
      liveHandicap: liveHcap,
      change: hcapChange,
      homeWater,
      awayWater,
      reasons,
      // 具体建议
      suggestion: this._handicapSuggestion(direction, liveHcap, confidence),
    };
  },

  _handicapSuggestion(direction, liveHcap, confidence) {
    if (direction === 'home') {
      if (liveHcap <= 0) return `客队受让${this._fmtHcap(Math.abs(liveHcap))}，推主队`;
      return `主队让${this._fmtHcap(liveHcap)}，推主队`;
    } else if (direction === 'away') {
      if (liveHcap >= 0) return `主队让${this._fmtHcap(liveHcap)}，推客队`;
      return `客队让${this._fmtHcap(Math.abs(liveHcap))}，推客队`;
    }
    return '盘口不明朗，建议观望';
  },

  // ========== 大小球分析 ==========
  _analyzeOverUnder(match, refOU) {
    const initOU = this._parseFraction(match.initOverUnder);
    const liveOU = this._parseFraction(match.liveOverUnder);

    if (initOU === null || liveOU === null) {
      return { direction: null, confidence: 0, reason: '数据不足' };
    }

    const ouChange = liveOU - initOU;
    const overWater = refOU ? refOU.overWater : null;
    const underWater = refOU ? refOU.underWater : null;

    let direction = null;  // 'over' | 'under'
    let confidence = 0;
    const reasons = [];

    if (ouChange > 0.3) {
      direction = 'over';
      confidence += 30;
      reasons.push(`大小球从${initOU}升至${liveOU}，机构预期进球增加`);
    } else if (ouChange > 0) {
      direction = 'over';
      confidence += 15;
      reasons.push(`大小球从${initOU}微升至${liveOU}`);
    } else if (ouChange < -0.3) {
      direction = 'under';
      confidence += 30;
      reasons.push(`大小球从${initOU}降至${liveOU}，机构预期进球减少`);
    } else if (ouChange < 0) {
      direction = 'under';
      confidence += 15;
      reasons.push(`大小球从${initOU}微降至${liveOU}`);
    } else {
      // 盘口不变看水位
      if (overWater !== null && overWater < 0.85) {
        direction = 'over';
        confidence += 10;
        reasons.push(`大小球盘口不变，大球低水(${overWater})`);
      } else if (underWater !== null && underWater < 0.85) {
        direction = 'under';
        confidence += 10;
        reasons.push(`大小球盘口不变，小球低水(${underWater})`);
      }
    }

    // 基于盘口绝对值判断
    if (liveOU >= 3.0) {
      reasons.push('高大小球线(≥3.0)，预期进球多');
      if (direction === 'over') confidence += 10;
    } else if (liveOU <= 2.0) {
      reasons.push('低大小球线(≤2.0)，预期进球少');
      if (direction === 'under') confidence += 10;
    }

    if (!direction) {
      // 默认根据大小球线给建议
      direction = liveOU >= 2.75 ? 'over' : 'under';
      confidence += 5;
      reasons.push(`基于盘口深度(${liveOU})默认判断`);
    }

    confidence = Math.max(0, Math.min(100, confidence));

    return {
      direction,
      confidence,
      initOverUnder: initOU,
      liveOverUnder: liveOU,
      change: ouChange,
      overWater,
      underWater,
      reasons,
      suggestion: direction === 'over'
        ? `推荐大球(盘口${liveOU}球)`
        : `推荐小球(盘口${liveOU}球)`,
    };
  },

  // ========== 胜平负分析 ==========
  _analyzeEuro(match, refEuro, refAsian, initHcap, liveHcap) {
    if (!refEuro && isNaN(liveHcap)) {
      return { direction: null, confidence: 0, reason: '数据不足' };
    }

    let direction = null;  // 'home' | 'draw' | 'away'
    let confidence = 0;
    const reasons = [];

    // 欧赔分析
    if (refEuro) {
      const { win, draw, lose } = refEuro;
      const lowest = Math.min(win, draw, lose);

      if (win === lowest && win < 1.80) {
        direction = 'home';
        confidence += 25;
        reasons.push(`主胜赔率最低(${win})，机构看好主胜`);
      } else if (lose === lowest && lose < 1.80) {
        direction = 'away';
        confidence += 25;
        reasons.push(`客胜赔率最低(${lose})，机构看好客胜`);
      } else if (draw === lowest || (Math.abs(win - lose) < 0.3 && draw < 3.8)) {
        direction = 'draw';
        confidence += 20;
        reasons.push(`胜平负赔率接近，平赔${draw}，平局可能大`);
      } else if (win < lose) {
        direction = 'home';
        confidence += 10;
        reasons.push(`主胜(${win}) < 客胜(${lose})，主队略占优`);
      } else {
        direction = 'away';
        confidence += 10;
        reasons.push(`客胜(${lose}) < 主胜(${win})，客队略占优`);
      }
    }

    // 亚盘+欧赔交叉验证
    if (!isNaN(liveHcap)) {
      if (direction === 'home' && liveHcap > 0.5) {
        confidence += 10;
        reasons.push('亚盘让球与欧赔主胜一致');
      } else if (direction === 'away' && liveHcap < -0.5) {
        confidence += 10;
        reasons.push('亚盘受让与欧赔客胜一致');
      } else if (direction === 'home' && liveHcap < 0) {
        confidence -= 10;
        reasons.push('警告：欧赔看主胜但亚盘受让，信号矛盾');
      } else if (direction === 'away' && liveHcap > 0) {
        confidence -= 10;
        reasons.push('警告：欧赔看客胜但亚盘让球，信号矛盾');
      }
      // 平手盘 → 平局可能性
      if (Math.abs(liveHcap) <= 0.25) {
        confidence -= 5;
        reasons.push('平手盘，胜平负方向不确定');
        if (direction !== 'draw' && confidence < 20) {
          direction = 'draw';
          confidence = Math.max(confidence, 10);
        }
      }
    }

    confidence = Math.max(0, Math.min(100, confidence));

    return {
      direction,
      confidence,
      winOdds: refEuro ? refEuro.win : null,
      drawOdds: refEuro ? refEuro.draw : null,
      loseOdds: refEuro ? refEuro.lose : null,
      reasons,
      suggestion: this._euroSuggestion(direction, refEuro),
    };
  },

  _euroSuggestion(direction, refEuro) {
    if (!refEuro) return '数据不足';
    const t = { home: '主胜', draw: '平局', away: '客胜' };
    return `推荐${t[direction] || '观望'}`;
  },

  // ========== 比分预测 ==========
  _predictScore(match, refAsian, refOU, handicapAdvice, ouAdvice) {
    const liveHcap = parseFloat(match.liveHandicap);

    // 获取大小球盘口
    let ouLine = 2.5; // default
    if (refOU && refOU.total) {
      ouLine = refOU.total;
    } else {
      const liveOU = this._parseFraction(match.liveOverUnder);
      if (liveOU !== null) ouLine = liveOU;
    }

    if (isNaN(liveHcap)) {
      return { scores: [], confidence: 0, reason: '数据不足' };
    }

    // 基于盘口深度推算预期进球差
    let expectedDiff = 0;
    if (liveHcap >= 1.5) expectedDiff = 2;
    else if (liveHcap >= 0.75) expectedDiff = 1;
    else if (liveHcap >= 0.25) expectedDiff = 0.5;
    else if (liveHcap <= -1.5) expectedDiff = -2;
    else if (liveHcap <= -0.75) expectedDiff = -1;
    else if (liveHcap <= -0.25) expectedDiff = -0.5;

    // 基于大小球推算预期总进球
    const totalGoals = Math.round(ouLine);

    // 推算可能的比分
    const scores = [];
    for (let home = 0; home <= 5; home++) {
      for (let away = 0; away <= 5; away++) {
        const diff = home - away;
        const total = home + away;

        // 比分需同时满足进球差和总进球约束
        const diffOk = Math.abs(diff - expectedDiff) <= 1;
        const totalOk = Math.abs(total - totalGoals) <= 1;
        const realistic = total <= 5 && home <= 4 && away <= 4;

        if (diffOk && totalOk && realistic) {
          scores.push(`${home}:${away}`);
        }
      }
    }

    // 按合理性排序（优先接近盘口的比分）
    scores.sort((a, b) => {
      const [h1, a1] = a.split(':').map(Number);
      const [h2, a2] = b.split(':').map(Number);
      const d1 = Math.abs((h1 - a1) - expectedDiff) + Math.abs((h1 + a1) - ouLine);
      const d2 = Math.abs((h2 - a2) - expectedDiff) + Math.abs((h2 + a2) - ouLine);
      return d1 - d2;
    });

    return {
      scores: scores.slice(0, 5),
      confidence: Math.min(60, scores.length * 10),
      expectedDiff,
      expectedTotal: ouLine,
      reason: `基于盘口(${this._fmtHcap(liveHcap)})推算进球差约${expectedDiff > 0 ? '+' + expectedDiff : expectedDiff}球，大小球${ouLine}球`,
    };
  },

  // ========== 综合摘要 ==========
  _makeSummary(handicap, ou, euro, score) {
    const parts = [];

    if (handicap.direction && handicap.confidence >= 20) {
      parts.push(handicap.suggestion);
    }
    if (ou.direction && ou.confidence >= 20) {
      parts.push(ou.suggestion);
    }
    if (euro.direction && euro.confidence >= 20) {
      parts.push(euro.suggestion);
    }
    if (score.scores && score.scores.length > 0) {
      parts.push(`比分参考：${score.scores.slice(0, 3).join(' / ')}`);
    }

    return parts.join('；');
  },

  // ========== 辅助函数 ==========
  _findCompany(oddsList, companyId) {
    return oddsList.find(o => o.companyId === companyId) || null;
  },

  _fmtHcap(val) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    if (val === 0) return '平手';
    const abs = Math.abs(val);
    const prefix = val > 0 ? '' : '客让';
    if (abs === 0.25) return `${prefix}平/半`;
    if (abs === 0.5) return `${prefix}半球`;
    if (abs === 0.75) return `${prefix}半/一`;
    if (abs === 1.0) return `${prefix}一球`;
    if (abs === 1.25) return `${prefix}一/球半`;
    if (abs === 1.5) return `${prefix}球半`;
    if (abs === 1.75) return `${prefix}球半/两`;
    if (abs === 2.0) return `${prefix}两球`;
    return `${prefix}${abs}`;
  },

  _parseFraction(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') return val;
    const str = String(val);
    if (str.includes('/')) {
      const parts = str.split('/');
      return (parseFloat(parts[0]) + parseFloat(parts[1])) / 2;
    }
    return parseFloat(str);
  },

  /**
   * 批量预测
   */
  predictAll(matches) {
    return matches
      .filter(m => m.round === 0) // 只预测未赛的
      .map(m => this.predict(m));
  },
};

// Node.js & Browser 兼容
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PredictEngine;
}
