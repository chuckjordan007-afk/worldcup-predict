/**
 * 世界杯预测 H5 — 主应用逻辑
 */

const App = {
  data: null,
  currentTab: 'upcoming',   // upcoming | finished | all
  currentSubTab: 'schedule', // schedule | standings | asian

  async init() {
    try {
      // 尝试加载数据
      const resp = await fetch('data/matches.json');
      if (!resp.ok) throw new Error('数据加载失败');
      this.data = await resp.json();
      
      // 显示更新时间
      document.getElementById('updateTime').textContent = 
        '数据更新：' + this.data.updateTime;
      
      this.render();
      this.bindEvents();
    } catch (err) {
      console.error(err);
      document.getElementById('matchList').innerHTML = `
        <div class="empty-state">
          <div class="icon">📡</div>
          <p>数据加载失败</p>
          <p style="font-size:12px;margin-top:8px;">请确保已运行爬虫生成数据文件</p>
        </div>`;
    }
  },

  bindEvents() {
    // Tab切换
    document.querySelectorAll('.tab-bar button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTab = btn.dataset.tab;
        this.renderMatches();
      });
    });
  },

  getMatches() {
    const all = [
      ...(this.data.groupMatches || []),
      ...(this.data.knockoutMatches || []),
    ];

    if (this.currentTab === 'upcoming') {
      return all.filter(m => m.round === 0);
    } else if (this.currentTab === 'finished') {
      return all.filter(m => m.round === -1);
    }
    return all;
  },

  render() {
    this.renderMatches();
  },

  renderMatches() {
    const matches = this.getMatches();
    const container = document.getElementById('matchList');
    
    if (matches.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="icon">⚽</div><p>暂无比赛</p></div>`;
      return;
    }

    // 按日期分组
    const groups = {};
    matches.forEach(m => {
      const date = m.datetime ? m.datetime.split(' ')[0] : '未知';
      if (!groups[date]) groups[date] = [];
      groups[date].push(m);
    });

    let html = '';
    for (const [date, ms] of Object.entries(groups)) {
      html += `<div style="padding: 8px 12px 0; font-size: 13px; font-weight: 600; color: var(--gray-500);">${date} ${this._dayOfWeek(date)}</div>`;
      
      ms.forEach(m => {
        const pred = PredictEngine.predict(m);
        html += this._renderCard(m, pred);
      });
    }

    container.innerHTML = html;

    // 绑定卡片点击
    container.querySelectorAll('.match-card').forEach(card => {
      card.addEventListener('click', () => {
        const matchId = parseInt(card.dataset.matchId);
        this.showDetail(matchId);
      });
    });
  },

  _renderCard(match, pred) {
    const isUpcoming = match.round === 0;
    const stageLabel = match.stage === 'group' 
      ? `${match.groupLabel}组` 
      : '淘汰赛';
    
    // 盘口标签
    let hcapTag = '';
    if (pred.handicap.direction === 'home') {
      hcapTag = `<span class="predict-tag home">主队盘口</span>`;
    } else if (pred.handicap.direction === 'away') {
      hcapTag = `<span class="predict-tag away">客队盘口</span>`;
    }

    // 大小球标签
    let ouTag = '';
    if (pred.overUnder.direction === 'over') {
      ouTag = `<span class="predict-tag over">大球</span>`;
    } else if (pred.overUnder.direction === 'under') {
      ouTag = `<span class="predict-tag under">小球</span>`;
    }

    // 胜平负标签
    let euroTag = '';
    if (pred.euro1x2.direction === 'home') {
      euroTag = `<span class="predict-tag home">主胜</span>`;
    } else if (pred.euro1x2.direction === 'away') {
      euroTag = `<span class="predict-tag away">客胜</span>`;
    } else if (pred.euro1x2.direction === 'draw') {
      euroTag = `<span class="predict-tag draw">平局</span>`;
    }

    // 比分
    let scoreTag = '';
    if (pred.score.scores && pred.score.scores.length > 0) {
      scoreTag = `<span class="predict-tag" style="background:#f3e5f5;color:#7b1fa2;">${pred.score.scores.slice(0,2).join('/')}</span>`;
    }

    return `
    <div class="match-card" data-match-id="${match.id}">
      <div class="card-header">
        <span class="date-tag">${match.datetime || ''}</span>
        <span class="stage-tag ${isUpcoming ? 'upcoming' : ''}">${stageLabel}</span>
      </div>
      <div class="teams">
        <div class="team">
          <div class="flag">${this._flagEmoji(match.homeName)}</div>
          <div class="name">${match.homeName}</div>
        </div>
        ${isUpcoming 
          ? '<div class="vs">VS</div>'
          : `<div class="score-display">${match.score || '?-?'}</div>`
        }
        <div class="team">
          <div class="flag">${this._flagEmoji(match.awayName)}</div>
          <div class="name">${match.awayName}</div>
        </div>
      </div>
      ${isUpcoming ? `
      <div class="predict-strip">
        ${hcapTag}${ouTag}${euroTag}${scoreTag}
      </div>
      <div class="card-footer">
        <span class="odds-summary">盘口:${this._fmtHcap(pred.handicap.liveHandicap)} | 大小:${pred.overUnder.liveOverUnder || match.liveOverUnder || '-'}球</span>
        <span class="arrow">›</span>
      </div>
      ` : `
      <div class="card-footer">
        <span class="odds-summary">半场 ${match.halfScore || '-'} | 盘口:${this._fmtHcap(parseFloat(match.liveHandicap))}</span>
        <span class="arrow">›</span>
      </div>
      `}
    </div>`;
  },

  showDetail(matchId) {
    const match = this._findMatch(matchId);
    if (!match) return;

    const pred = PredictEngine.predict(match);
    
    // 构建详情HTML
    const detailHtml = this._buildDetail(match, pred);
    
    // 保存当前页面HTML，用于返回
    this._savedPageHTML = document.getElementById('app').innerHTML;
    this._savedScrollY = window.scrollY;
    
    // 只替换app内容区域，保留body结构
    document.getElementById('app').innerHTML = detailHtml;
    
    // 绑定返回按钮
    document.getElementById('backBtn').addEventListener('click', () => {
      this._goBackToList();
    });

    // 滚动到顶部
    window.scrollTo(0, 0);
  },

  _goBackToList() {
    // 恢复页面结构
    document.getElementById('app').innerHTML = this._savedPageHTML;
    // 重新绑定事件
    this.bindEvents();
    this.renderMatches();
    // 恢复滚动位置
    window.scrollTo(0, this._savedScrollY || 0);
  },

  _buildDetail(match, pred) {
    const isUpcoming = match.round === 0;
    const h = pred.handicap;
    const ou = pred.overUnder;
    const eu = pred.euro1x2;
    const sc = pred.score;

    // 盘口建议
    const hcapIcon = h.direction === 'home' ? '🏠' : h.direction === 'away' ? '✈️' : '⚖️';
    const hcapClass = h.direction || 'draw';
    const hcapConfClass = h.confidence >= 60 ? 'high' : h.confidence >= 30 ? 'medium' : 'low';

    // 大小球建议
    const ouIcon = ou.direction === 'over' ? '⬆️' : ou.direction === 'under' ? '⬇️' : '⚖️';
    const ouClass = ou.direction || 'draw';
    const ouConfClass = ou.confidence >= 60 ? 'high' : ou.confidence >= 30 ? 'medium' : 'low';

    // 胜平负建议
    const euIcon = eu.direction === 'home' ? '🏠' : eu.direction === 'away' ? '✈️' : '🤝';
    const euClass = eu.direction || 'draw';
    const euConfClass = eu.confidence >= 60 ? 'high' : eu.confidence >= 30 ? 'medium' : 'low';

    let html = `
    <div class="detail-header">
      <div style="text-align:left;margin-bottom:8px;">
        <button id="backBtn" class="back-btn">← 返回</button>
      </div>
      <div class="teams-large">
        <div class="team-large">
          <div class="flag-lg">${this._flagEmoji(match.homeName)}</div>
          <div class="name-lg">${match.homeName}</div>
        </div>
        <div class="vs-lg">
          ${isUpcoming ? 'VS' : `<span style="font-size:24px;font-weight:700;color:#212121;">${match.score}</span>`}
        </div>
        <div class="team-large">
          <div class="flag-lg">${this._flagEmoji(match.awayName)}</div>
          <div class="name-lg">${match.awayName}</div>
        </div>
      </div>
      <div class="match-info">
        ${match.datetime} | ${match.stage === 'group' ? match.groupLabel + '组' : '淘汰赛'}
        ${!isUpcoming ? ` | 半场 ${match.halfScore}` : ''}
      </div>
    </div>`;

    // 预测面板 (仅未赛显示)
    if (isUpcoming) {
      html += `
    <div class="predict-panel">
      <div class="panel-title">📊 预测分析</div>
      
      <div class="advice-row">
        <div class="advice-icon ${hcapClass}">${hcapIcon}</div>
        <div class="advice-content">
          <div class="advice-label">盘口建议</div>
          <div class="advice-value">${h.suggestion}</div>
        </div>
        <div class="advice-confidence">
          信心<br>
          <span class="bar"><span class="bar-fill ${hcapConfClass}" style="width:${h.confidence}%"></span></span>
          ${h.confidence}%
        </div>
      </div>

      <div class="advice-row">
        <div class="advice-icon ${ouClass}">${ouIcon}</div>
        <div class="advice-content">
          <div class="advice-label">大小球建议</div>
          <div class="advice-value">${ou.suggestion}</div>
        </div>
        <div class="advice-confidence">
          信心<br>
          <span class="bar"><span class="bar-fill ${ouConfClass}" style="width:${ou.confidence}%"></span></span>
          ${ou.confidence}%
        </div>
      </div>

      <div class="advice-row">
        <div class="advice-icon ${euClass}">${euIcon}</div>
        <div class="advice-content">
          <div class="advice-label">胜平负建议</div>
          <div class="advice-value">${eu.suggestion}</div>
        </div>
        <div class="advice-confidence">
          信心<br>
          <span class="bar"><span class="bar-fill ${euConfClass}" style="width:${eu.confidence}%"></span></span>
          ${eu.confidence}%
        </div>
      </div>

      <div class="score-row">
        <div style="font-size:13px;color:var(--gray-500);">🔮 比分预测</div>
        <div class="score-badges">
          ${(sc.scores || []).map(s => `<span class="score-badge">${s}</span>`).join('')}
        </div>
        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">${sc.reason || ''}</div>
      </div>
    </div>`;

      // 盘口变化详情
      html += `
    <div class="odds-section">
      <div class="section-title">📈 盘口变化</div>
      <table class="odds-table">
        <tr><th></th><th>初盘</th><th>即时盘</th><th>变化</th></tr>
        <tr>
          <td class="company-name">亚盘(让球)</td>
          <td>${this._fmtHcap(h.initHandicap)}</td>
          <td>${this._fmtHcap(h.liveHandicap)}</td>
          <td style="color:${h.change > 0 ? 'var(--green)' : h.change < 0 ? 'var(--red)' : ''}">${h.change > 0 ? '↑升' : h.change < 0 ? '↓降' : '→平'}</td>
        </tr>
        ${h.homeWater !== null ? `
        <tr>
          <td class="company-name">主队水位</td>
          <td>-</td>
          <td>${h.homeWater}</td>
          <td>-</td>
        </tr>` : ''}
        ${h.awayWater !== null ? `
        <tr>
          <td class="company-name">客队水位</td>
          <td>-</td>
          <td>${h.awayWater}</td>
          <td>-</td>
        </tr>` : ''}
        <tr>
          <td class="company-name">大小球</td>
          <td>${ou.initOverUnder !== null ? ou.initOverUnder + '球' : '-'}</td>
          <td>${ou.liveOverUnder !== null ? ou.liveOverUnder + '球' : '-'}</td>
          <td style="color:${ou.change > 0 ? 'var(--orange)' : ou.change < 0 ? 'var(--blue)' : ''}">${ou.change > 0 ? '↑升' : ou.change < 0 ? '↓降' : '→平'}</td>
        </tr>
      </table>
    </div>`;

      // 分析理由
      if (h.reasons && h.reasons.length > 0) {
        html += `
    <div class="odds-section">
      <div class="section-title">💡 分析理由</div>
      <ul class="reasons-list">
        ${h.reasons.map(r => `<li>${r}</li>`).join('')}
        ${ou.reasons ? ou.reasons.map(r => `<li>${r}</li>`).join('') : ''}
        ${eu.reasons ? eu.reasons.map(r => `<li>${r}</li>`).join('') : ''}
      </ul>
    </div>`;
      }
    }

    // 完整赔率表
    const asianOdds = match.odds ? (match.odds.asian || []) : [];
    const ouOdds = match.odds ? (match.odds.overUnder || []) : [];
    
    if (asianOdds.length > 0) {
      html += `
    <div class="odds-section">
      <div class="section-title">🏷️ 亚盘赔率（各公司）</div>
      <table class="odds-table">
        <tr><th>公司</th><th>主水</th><th>盘口</th><th>客水</th></tr>
        ${asianOdds.map(o => `
        <tr>
          <td class="company-name">${o.companyName}</td>
          <td>${o.homeWater}</td>
          <td>${this._fmtHcap(o.handicap)}</td>
          <td>${o.awayWater}</td>
        </tr>`).join('')}
      </table>
    </div>`;
    }

    if (ouOdds.length > 0) {
      html += `
    <div class="odds-section">
      <div class="section-title">⚽ 大小球赔率</div>
      <table class="odds-table">
        <tr><th>公司</th><th>大球</th><th>盘口</th><th>小球</th></tr>
        ${ouOdds.map(o => `
        <tr>
          <td class="company-name">${o.companyName}</td>
          <td>${o.overWater}</td>
          <td>${o.total}球</td>
          <td>${o.underWater}</td>
        </tr>`).join('')}
      </table>
    </div>`;
    }

    // 数据来源
    html += `
    <div class="data-source">
      数据来源：<a href="https://zq.titan007.com/cn/CupMatch/75.html" target="_blank">球探体育</a>
      &nbsp;|&nbsp; 仅供参考，不构成投注建议
    </div>`;

    return html;
  },

  _findMatch(matchId) {
    const all = [
      ...(this.data.groupMatches || []),
      ...(this.data.knockoutMatches || []),
    ];
    return all.find(m => m.id === matchId);
  },

  _flagEmoji(name) {
    // 简易国旗映射（常用球队）
    const map = {
      '阿根廷': '🇦🇷', '巴西': '🇧🇷', '德国': '🇩🇪', '法国': '🇫🇷',
      '英格兰': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '西班牙': '🇪🇸', '意大利': '🇮🇹', '荷兰': '🇳🇱',
      '葡萄牙': '🇵🇹', '比利时': '🇧🇪', '克罗地亚': '🇭🇷', '乌拉圭': '🇺🇾',
      '日本': '🇯🇵', '韩国': '🇰🇷', '澳大利亚': '🇦🇺', '伊朗': '🇮🇷',
      '沙特阿拉伯': '🇸🇦', '墨西哥': '🇲🇽', '美国': '🇺🇸', '加拿大': '🇨🇦',
      '摩洛哥': '🇲🇦', '塞内加尔': '🇸🇳', '突尼斯': '🇹🇳', '加纳': '🇬🇭',
      '喀麦隆': '🇨🇲', '尼日利亚': '🇳🇬', '埃及': '🇪🇬', '阿尔及利亚': '🇩🇿',
      '南非': '🇿🇦', '科特迪瓦': '🇨🇮', '丹麦': '🇩🇰', '瑞典': '🇸🇪',
      '挪威': '🇳🇴', '波兰': '🇵🇱', '瑞士': '🇨🇭', '奥地利': '🇦🇹',
      '塞尔维亚': '🇷🇸', '捷克': '🇨🇿', '苏格兰': '🇬🇧', '威尔士': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      '乌克兰': '🇺🇦', '土耳其': '🇹🇷', '俄罗斯': '🇷🇺', '希腊': '🇬🇷',
      '中国': '🇨🇳', '卡塔尔': '🇶🇦', '阿联酋': '🇦🇪', '伊拉克': '🇮🇶',
      '哥斯达黎加': '🇨🇷', '哥伦比亚': '🇨🇴', '智利': '🇨🇱', '秘鲁': '🇵🇪',
      '厄瓜多尔': '🇪🇨', '巴拉圭': '🇵🇾', '委内瑞拉': '🇻🇪', '巴拿马': '🇵🇦',
      '洪都拉斯': '🇭🇳', '牙买加': '🇯🇲', '新西兰': '🇳🇿',
      '波黑': '🇧🇦', '佛得角': '🇨🇻', '刚果民主共和国': '🇨🇩',
      '乌兹别克斯坦': '🇺🇿', '约旦': '🇯🇴', '海地': '🇭🇹', '库拉索': '🇨🇼',
    };
    return map[name] || '⚽';
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

  _dayOfWeek(dateStr) {
    try {
      const d = new Date(dateStr);
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return days[d.getDay()];
    } catch { return ''; }
  },
};

// 启动
document.addEventListener('DOMContentLoaded', () => App.init());
