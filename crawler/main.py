"""
世界杯预测 H5 — Python 爬虫 v2
"""
import requests
import re
import json
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
os.makedirs(OUT_DIR, exist_ok=True)

SESSION = requests.Session()
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://zq.titan007.com/cn/CupMatch/75.html",
}

COMPANY_NAMES = {
    1:"澳门", 3:"Crown", 4:"立博(大小)", 8:"36", 9:"立博", 12:"利胜", 14:"伟德",
    17:"易胜博", 19:"明升", 22:"10B", 23:"金宝博", 24:"12B", 31:"YSB", 35:"盈丰",
    42:"18B", 49:"平博",
    16:"10*", 18:"12*", 70:"Exp*", 80:"澳*", 81:"伟*", 82:"永*", 88:"Cora*",
    90:"利胜*", 104:"Interwet*", 110:"SNA*", 115:"立博*", 173:"bet-at-h*",
    177:"Pinna*", 255:"Bwi*", 281:"36*", 422:"易胜博*", 432:"易胜*", 474:"盈*",
    499:"18B*", 517:"明*", 545:"Crow*", 649:"IBC*", 659:"盈*", 976:"18B*", 1129:"竞彩官方",
}

# ============ 1. 获取并解析 c75.js ============
def fetch_c75():
    resp = SESSION.get("https://zq.titan007.com/jsData/matchResult/2026/c75.js", headers=HEADERS, timeout=30)
    resp.encoding = "utf-8"
    return resp.text

def parse_teams(js_text):
    """解析 arrTeam"""
    teams = {}
    pattern = r"\[(\d+),'([^']*)','([^']*)','([^']*)','[^']*','([^']*)'\]"
    for m in re.finditer(pattern, js_text):
        tid = int(m.group(1))
        teams[tid] = {
            "id": tid, "nameCN": m.group(2), "nameEN": m.group(4), "flag": m.group(5)
        }
    return teams

def parse_matches(js_text, teams):
    """解析 jh entries 中的比赛"""
    # Find all jh entries: jh["KEY"] = [[...],[...]];
    # Use a more robust approach: find each jh block and parse line by line
    pattern = r'jh\["([^"]+)"\]\s*=\s*\[(.+?)\];\s*\n'
    matches_raw = list(re.finditer(pattern, js_text, re.DOTALL))
    
    all_matches = []
    
    for m in matches_raw:
        key = m.group(1)
        body = m.group(2)
        
        if not (key.startswith("G") or key.startswith("K")):
            continue
        
        is_group = key.startswith("G")
        stage = "group" if is_group else "knockout"
        
        # Each match entry is like: [2906701,75,-1,'2026-06-12 03:00',819,803,'2-0','1-0',...]
        # Split by finding each [...]
        entries = re.findall(r'\[([^\]]+(?:\[[^\]]*\][^\]]*)*)\]', body)
        
        for entry_text in entries:
            # Simple split by comma, but careful about commas inside quotes
            parts = []
            current = ""
            in_quote = False
            for ch in entry_text:
                if ch == "'" and not in_quote:
                    in_quote = True
                    current += ch
                elif ch == "'" and in_quote:
                    in_quote = False
                    current += ch
                elif ch == "," and not in_quote:
                    parts.append(current.strip())
                    current = ""
                else:
                    current += ch
            if current:
                parts.append(current.strip())
            
            if len(parts) < 14:
                continue
            
            # Clean up parts
            parts = [p.strip("'\" ") for p in parts]
            
            try:
                match_id = int(parts[0])
            except ValueError:
                continue
            
            home_id = int(parts[4]) if parts[4].isdigit() else None
            away_id = int(parts[5]) if parts[5].isdigit() else None
            
            home_name = teams.get(home_id, {}).get("nameCN", parts[4]) if home_id else parts[4]
            away_name = teams.get(away_id, {}).get("nameCN", parts[5]) if away_id else parts[5]
            
            match = {
                "id": match_id,
                "groupId": key,
                "stage": stage,
                "groupLabel": key.replace("G27970", "") if is_group else key,
                "round": int(parts[2]) if parts[2].lstrip("-").isdigit() else 0,
                "datetime": parts[3],
                "homeId": home_id,
                "awayId": away_id,
                "homeName": home_name,
                "awayName": away_name,
                "homeNameEN": teams.get(home_id, {}).get("nameEN", "") if home_id else "",
                "awayNameEN": teams.get(away_id, {}).get("nameEN", "") if away_id else "",
                "homeFlag": teams.get(home_id, {}).get("flag", "") if home_id else "",
                "awayFlag": teams.get(away_id, {}).get("flag", "") if away_id else "",
                "score": parts[6] if parts[6] else None,
                "halfScore": parts[7] if parts[7] else None,
                "initHandicap": safe_float(parts[10]),
                "liveHandicap": safe_float(parts[11]),
                "initOverUnder": safe_float_str(parts[12]),
                "liveOverUnder": safe_float_str(parts[13]),
            }
            
            all_matches.append(match)
    
    return all_matches

def safe_float(val):
    try: return float(val)
    except: return val

def safe_float_str(val):
    try:
        f = float(val)
        return f
    except:
        return val

# ============ 2. 赔率数据 ============
def fetch_odds():
    resp = SESSION.get("https://zq.titan007.com/League/LeagueOddsAjax", 
                       params={"sclassId":75,"subSclassId":"","matchSeason":"2026","round":1},
                       headers=HEADERS, timeout=30)
    resp.encoding = "utf-8"
    return resp.text

def parse_odds(odds_text):
    """Parse oddsData into dict: {matchId: {L:[...], O:[...], T:[...]}}"""
    result = {}
    
    # Pattern: oddsData["TYPE_MATCHID"]=[[...],[...]];
    pattern = r'oddsData\["([OTL])_(\d+)"\]\s*=\s*\[(.+?)\];'
    
    for m in re.finditer(pattern, odds_text):
        otype = m.group(1)
        match_id = int(m.group(2))
        body = m.group(3)
        
        if match_id not in result:
            result[match_id] = {"asian": [], "overUnder": [], "euro1x2": []}
        
        # Parse each company entry: [companyId, val1, val2, val3]
        entries = re.findall(r'\[([^\]]+)\]', body)
        for entry_text in entries:
            vals = [v.strip() for v in entry_text.split(",")]
            if len(vals) < 4:
                continue
            try:
                cid = int(vals[0])
            except ValueError:
                continue
            
            entry = {
                "companyId": cid,
                "companyName": COMPANY_NAMES.get(cid, f"ID{cid}"),
            }
            
            if otype == "O":  # 欧赔
                entry["win"] = float(vals[1])
                entry["draw"] = float(vals[2])
                entry["lose"] = float(vals[3])
                result[match_id]["euro1x2"].append(entry)
            elif otype == "L":  # 亚盘
                entry["homeWater"] = float(vals[1])
                entry["handicap"] = float(vals[2])
                entry["awayWater"] = float(vals[3])
                result[match_id]["asian"].append(entry)
            elif otype == "T":  # 大小球
                entry["overWater"] = float(vals[1])
                entry["total"] = float(vals[2])
                entry["underWater"] = float(vals[3])
                result[match_id]["overUnder"].append(entry)
    
    return result

# ============ 3. 整合 ============
def main():
    print("[1/3] Fetching match data...")
    js_text = fetch_c75()
    
    print("[2/3] Parsing teams & matches...")
    teams = parse_teams(js_text)
    matches = parse_matches(js_text, teams)
    print(f"  Teams: {len(teams)}, Matches: {len(matches)}")
    
    print("[3/3] Fetching odds...")
    odds_text = fetch_odds()
    odds = parse_odds(odds_text)
    print(f"  Matches with odds: {len(odds)}")
    
    # Merge odds into matches
    for match in matches:
        mid = match["id"]
        if mid in odds:
            match["odds"] = odds[mid]
        else:
            match["odds"] = {"asian": [], "overUnder": [], "euro1x2": []}
    
    # Sort
    upcoming = [m for m in matches if m["round"] == 0]
    finished = [m for m in matches if m["round"] == -1]
    upcoming.sort(key=lambda m: m["datetime"])
    finished.sort(key=lambda m: m["datetime"], reverse=True)
    matches_sorted = upcoming + finished
    
    group_matches = [m for m in matches_sorted if m["stage"] == "group"]
    knockout_matches = [m for m in matches_sorted if m["stage"] == "knockout"]
    
    output = {
        "cupId": 75,
        "cupName": "2026世界杯",
        "cupNameEN": "FIFA World Cup 2026",
        "updateTime": __import__('datetime').datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "teamCount": len(teams),
        "matchCount": len(matches),
        "teams": {str(k): v for k, v in sorted(teams.items())},
        "groupMatches": group_matches,
        "knockoutMatches": knockout_matches,
    }
    
    out_path = os.path.join(OUT_DIR, "matches.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"\nSaved to: {out_path}")
    print(f"  Upcoming: {len(upcoming)}, Finished: {len(finished)}")
    
    if upcoming:
        print("\n=== Upcoming matches ===")
        for m in upcoming[:15]:
            print(f"  {m['datetime']} | {m['homeName']} vs {m['awayName']} | 亚盘:{m['initHandicap']}/{m['liveHandicap']} | 大小:{m['initOverUnder']}/{m['liveOverUnder']}")

if __name__ == "__main__":
    main()
