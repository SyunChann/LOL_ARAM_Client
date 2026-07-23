import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  Clock,
  Database,
  Flame,
  Gauge,
  History,
  ListFilter,
  Search,
  ShieldCheck,
  Swords,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import './styles.css';

const defaultRiotId = `${'뿡'.repeat(15)}뽕#${'뿡'.repeat(5)}`;

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(value || 0);
}

function formatKda(match) {
  return `${match.kills} / ${match.deaths} / ${match.assists}`;
}

function parseRiotId(value) {
  const [gameName, tagLine] = value.split('#');
  return {
    gameName: gameName?.trim() || defaultRiotId.split('#')[0],
    tagLine: tagLine?.trim() || defaultRiotId.split('#')[1],
  };
}

function normalizeChampionStats(matches) {
  const byChampion = new Map();

  for (const match of matches) {
    const current = byChampion.get(match.champion) || {
      name: match.champion,
      games: 0,
      wins: 0,
      totalDamage: 0,
    };

    current.games += 1;
    current.wins += match.win ? 1 : 0;
    current.totalDamage += match.damage;
    byChampion.set(match.champion, current);
  }

  return [...byChampion.values()]
    .map((champion) => ({
      ...champion,
      winRate: Math.round((champion.wins / champion.games) * 100),
      avgDamage: Math.round(champion.totalDamage / champion.games),
      grade: getGrade(champion.games, champion.wins, champion.totalDamage / champion.games),
    }))
    .sort((a, b) => b.games - a.games || b.avgDamage - a.avgDamage);
}

function getGrade(games, wins, avgDamage) {
  const winRate = wins / games;
  if (games >= 3 && winRate >= 0.65) return 'S';
  if (winRate >= 0.55 || avgDamage >= 50000) return 'A';
  if (winRate >= 0.45) return 'B';
  return 'C';
}

function App() {
  const [query, setQuery] = useState(defaultRiotId);
  const [activeRiotId, setActiveRiotId] = useState(defaultRiotId);
  const [data, setData] = useState(null);
  const [exploreData, setExploreData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [lcuStatus, setLcuStatus] = useState('idle');
  const [exploreStatus, setExploreStatus] = useState('idle');
  const [detailStatus, setDetailStatus] = useState('idle');
  const [detailTargetId, setDetailTargetId] = useState(null);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [isChampionDialogOpen, setIsChampionDialogOpen] = useState(false);
  const [error, setError] = useState('');
  const [lcuError, setLcuError] = useState('');
  const [exploreError, setExploreError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [matchFilter, setMatchFilter] = useState('all');
  const [matchOrder, setMatchOrder] = useState('recent');
  const profile = data?.account || parseRiotId(activeRiotId);

  useEffect(() => {
    handleLcuLoad();
  }, []);

  const matches = data?.matches || [];
  const wins = matches.filter((match) => match.win).length;
  const avgChaos = matches.length
    ? Math.round(matches.reduce((sum, match) => sum + match.chaos, 0) / matches.length)
    : 0;
  const avgDamage = matches.length
    ? Math.round(matches.reduce((sum, match) => sum + match.damage, 0) / matches.length)
    : 0;
  const bestMatch = matches.reduce((best, match) => (!best || match.chaos > best.chaos ? match : best), null);
  const champions = normalizeChampionStats(matches);
  const displayedMatches = useMemo(() => {
    const filtered = matches.filter((match) => (
      matchFilter === 'all' || (matchFilter === 'win' ? match.win : !match.win)
    ));

    return [...filtered].sort((a, b) => (
      matchOrder === 'chaos' ? b.chaos - a.chaos : 0
    ));
  }, [matches, matchFilter, matchOrder]);

  function handleSubmit(event) {
    event.preventDefault();
    handleLcuLoad();
  }

  async function handleLcuLoad() {
    setStatus('loading');
    setLcuStatus('loading');
    setLcuError('');

    try {
      const response = await fetch('/api/lcu/mayhem?count=20');
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || '클라이언트 전적을 가져오지 못했습니다.');
      }

      setData(payload);
      setExploreData(null);
      setDetailTargetId(null);
      setSelectedMatch(null);
      setDetailStatus('idle');
      setLcuStatus('ready');
      setStatus('ready');
    } catch (err) {
      setLcuError(err.message);
      setLcuStatus('error');
      setStatus('error');
    }
  }

  async function handleExplore() {
    setExploreStatus('loading');
    setExploreError('');

    try {
      const response = await fetch(`/api/explore?riotId=${encodeURIComponent(activeRiotId)}&start=0&count=40`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || '큐 탐색에 실패했습니다.');
      }

      setExploreData(payload);
      setExploreStatus('ready');
    } catch (err) {
      setExploreError(err.message);
      setExploreStatus('error');
    }
  }

  async function handleMatchClick(match) {
    if (data?.source !== 'LCU') return;

    if (detailTargetId === match.id && selectedMatch) {
      setDetailTargetId(null);
      setSelectedMatch(null);
      setDetailStatus('idle');
      return;
    }

    setDetailStatus('loading');
    setDetailTargetId(match.id);
    setSelectedMatch(null);
    setDetailError('');

    try {
      const response = await fetch(`/api/lcu/mayhem/${match.id}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || '상세 정보를 가져오지 못했습니다.');
      }

      setSelectedMatch(payload);
      setDetailStatus('ready');
    } catch (err) {
      setDetailError(err.message);
      setDetailStatus('error');
    }
  }

  return (
    <main className="app-shell">
      <nav className="topbar" aria-label="주요">
        <div className="brand">
          <span className="brand-mark"><Flame size={18} /></span>
          <span>아수라장 전적</span>
        </div>
        <div className="queue-pill">LCU + queueId 2400</div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">무작위 총력전: 아수라장</p>
          <h1>{profile.gameName}<span>#{profile.tagLine}</span></h1>
          <p className="hero-subcopy">롤 클라이언트 대전 기록 기반 아수라장 전적</p>
        </div>

        <form className="search-panel" onSubmit={handleSubmit}>
          <div className="search-heading">
            <label htmlFor="riot-id">현재 클라이언트 계정</label>
            {champions.length > 0 && (
              <button type="button" className="ghost-button" onClick={() => setIsChampionDialogOpen(true)}>
                <ShieldCheck size={16} />
                챔피언 성적
              </button>
            )}
          </div>
          <div className="search-row">
            <Search size={20} aria-hidden="true" />
            <input
              id="riot-id"
              value={`${profile.gameName}#${profile.tagLine}`}
              readOnly
            />
            <button type="submit" disabled={status === 'loading'}>
              <ArrowUpRight size={18} />
              새로고침
            </button>
          </div>
          {data?.updatedAt && <p className="search-meta">최근 갱신: {data.updatedAt}</p>}
        </form>
      </section>

      {status === 'loading' && <StateMessage title="클라이언트 전적 조회 중" body="실행 중인 롤 클라이언트의 아수라장 대전 기록을 읽고 있습니다." />}
      {status === 'error' && <StateMessage title="롤 클라이언트 연결 필요" body={lcuError || '롤 클라이언트를 실행하고 로그인한 뒤 새로고침해 주세요.'} />}

      {status === 'ready' && matches.length === 0 && (
        <StateMessage title="아수라장 기록 없음" body="롤 클라이언트의 최근 대전 기록에서 아수라장 경기를 찾지 못했습니다." />
      )}

      {exploreStatus === 'loading' && <StateMessage title="큐 탐색 중" body="최근 매치 상세를 순차 조회하고 있습니다." />}
      {exploreStatus === 'error' && <StateMessage title="큐 탐색 실패" body={exploreError} />}
      {exploreStatus === 'ready' && exploreData && <ExplorePanel data={exploreData} />}

      {matches.length > 0 && (
        <>
          <section className="stat-grid" aria-label="요약 통계">
            <SummaryCard icon={<Trophy />} label="최근 승률" value={`${Math.round((wins / matches.length) * 100)}%`} detail={`${wins}승 ${matches.length - wins}패`} />
            <SummaryCard icon={<Gauge />} label="아수라 지수" value={avgChaos} detail={`최근 ${matches.length}경기 평균`} />
            <SummaryCard icon={<Swords />} label="평균 딜량" value={formatNumber(avgDamage)} detail="챔피언 피해량" />
            <SummaryCard icon={<Zap />} label="최고 난전" value={bestMatch?.champion || '-'} detail={bestMatch ? `${bestMatch.chaos}점 · ${bestMatch.duration}` : '-'} />
          </section>

          <section className="content-layout">
            <div className="match-column">
              <div className="section-heading">
                <div>
                  <span className="section-kicker"><History size={15} /> MATCH HISTORY</span>
                  <h2>최근 아수라장</h2>
                </div>
                <div className="match-controls" aria-label="경기 목록 제어">
                  <div className="filter-group" role="group" aria-label="승패 필터">
                    <ListFilter size={15} aria-hidden="true" />
                    {[
                      ['all', '전체'],
                      ['win', '승리'],
                      ['loss', '패배'],
                    ].map(([value, label]) => (
                      <button
                        type="button"
                        className={matchFilter === value ? 'active' : ''}
                        key={value}
                        onClick={() => setMatchFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => setMatchOrder((order) => order === 'recent' ? 'chaos' : 'recent')}
                  >
                    {matchOrder === 'recent' ? '최신순' : '난전 지수순'}
                  </button>
                </div>
              </div>
              <div className="match-list">
                {displayedMatches.map((match) => (
                  <React.Fragment key={match.id}>
                    <article
                      className={`match-card ${match.win ? 'win' : 'loss'} ${data?.source === 'LCU' ? 'clickable' : ''}`}
                      onClick={() => handleMatchClick(match)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleMatchClick(match);
                        }
                      }}
                      role={data?.source === 'LCU' ? 'button' : undefined}
                      tabIndex={data?.source === 'LCU' ? 0 : undefined}
                    >
                      <div className="match-main">
                        <div>
                          <span className="result">{match.win ? '승리' : '패배'}</span>
                          <h3>{match.champion}</h3>
                          <p>{match.modeName || '무작위 총력전: 아수라장'}</p>
                          <p>{match.duration} · {match.mapName} · {match.playedAt}</p>
                        </div>
                        <div className="kda-block">
                          <strong>{formatKda(match)}</strong>
                          <span>KDA {match.kdaRatio}</span>
                        </div>
                      </div>
                      <div className="metrics">
                        <Metric label="딜량" value={formatNumber(match.damage)} />
                        <Metric label="받은 피해" value={formatNumber(match.taken)} />
                        <Metric label="골드" value={formatNumber(match.gold)} />
                        <Metric label="난전 지수" value={`${match.chaos}점`} />
                      </div>
                      <MatchPreview match={match} />
                      <div className="tag-row">
                        <span>레벨 {match.level}</span>
                        <span>CS {match.cs}</span>
                      </div>
                      <div className="chaos-meter">
                        <div style={{ width: `${match.chaos}%` }} />
                      </div>
                    </article>

                    {detailTargetId === match.id && detailStatus === 'loading' && (
                      <StateMessage title="상세 정보 조회 중" body="롤 클라이언트에서 해당 경기의 10명 상세 기록을 읽고 있습니다." />
                    )}
                    {detailTargetId === match.id && detailStatus === 'error' && (
                      <StateMessage title="상세 정보 실패" body={detailError} />
                    )}
                    {detailTargetId === match.id && detailStatus === 'ready' && selectedMatch && (
                      <MatchDetail
                        detail={selectedMatch}
                        onClose={() => {
                          setSelectedMatch(null);
                          setDetailTargetId(null);
                          setDetailStatus('idle');
                        }}
                      />
                    )}
                  </React.Fragment>
                ))}
                {displayedMatches.length === 0 && (
                  <div className="empty-filter">선택한 조건에 맞는 경기가 없습니다.</div>
                )}
              </div>
            </div>
          </section>

          {isChampionDialogOpen && (
            <ChampionDialog champions={champions} onClose={() => setIsChampionDialogOpen(false)} />
          )}
        </>
      )}
    </main>
  );
}

function ChampionDialog({ champions, onClose }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section className="champion-dialog" role="dialog" aria-modal="true" aria-labelledby="champion-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="detail-header">
          <div>
            <span>아수라장 누적</span>
            <h2 id="champion-dialog-title">챔피언 성적</h2>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="챔피언 성적 닫기">
            <X size={18} />
          </button>
        </div>

        <div className="champion-dialog-grid">
          {champions.map((champion) => (
            <div className="champion-row" key={champion.name}>
              <div className="grade">{champion.grade}</div>
              <div>
                <strong>{champion.name}</strong>
                <span>{champion.games}게임 · 승률 {champion.winRate}%</span>
              </div>
              <em>{formatNumber(champion.avgDamage)}</em>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MatchDetail({ detail, onClose }) {
  const currentPlayer = detail.teams
    .flatMap((team) => team.players)
    .find((player) => player.isCurrentSummoner);
  const allPlayers = detail.teams.flatMap((team) => team.players);
  const maxDamage = Math.max(...allPlayers.map((player) => player.damage), 1);
  const maxTaken = Math.max(...allPlayers.map((player) => player.taken), 1);
  const totals = detail.teams.map((team) => ({
    teamId: team.teamId,
    win: team.win,
    kills: team.players.reduce((sum, player) => sum + player.kills, 0),
    gold: team.players.reduce((sum, player) => sum + player.gold, 0),
    damage: team.players.reduce((sum, player) => sum + player.damage, 0),
  }));
  const maxTeamKills = Math.max(...totals.map((team) => team.kills), 1);
  const maxTeamGold = Math.max(...totals.map((team) => team.gold), 1);

  return (
    <section className="detail-panel">
      <div className="match-summary-strip">
        <div>
          <span className={currentPlayer?.isCurrentSummoner ? 'mode-label' : 'mode-label'}>{detail.game.modeName}</span>
          <strong>{detail.game.duration}</strong>
          <p>{detail.game.mapName} · {detail.game.playedAt}</p>
        </div>
        {currentPlayer && (
          <div className="summary-player">
            <ChampionIcon championId={currentPlayer.championId} />
            <div>
              <strong>{currentPlayer.champion}</strong>
              <span>{currentPlayer.kills} / {currentPlayer.deaths} / {currentPlayer.assists}</span>
            </div>
          </div>
        )}
        <div className="team-bars">
          {totals.map((team) => (
            <div className="team-bar-row" key={team.teamId}>
              <span>{team.win ? '승리' : '패배'}</span>
              <div className="team-bar-track">
                <i className={team.win ? 'ally-bar' : 'enemy-bar'} style={{ width: `${(team.kills / maxTeamKills) * 100}%` }} />
              </div>
              <b>{team.kills}</b>
            </div>
          ))}
          {totals.map((team) => (
            <div className="team-bar-row gold" key={`${team.teamId}-gold`}>
              <span>골드</span>
              <div className="team-bar-track">
                <i className={team.win ? 'ally-bar' : 'enemy-bar'} style={{ width: `${(team.gold / maxTeamGold) * 100}%` }} />
              </div>
              <b>{formatNumber(team.gold)}</b>
            </div>
          ))}
        </div>
        <button type="button" className="close-button" onClick={onClose} aria-label="상세 닫기">
          <X size={18} />
        </button>
      </div>

      <div className="detail-scroll">
        <div className="scoreboard">
          {detail.teams.map((team) => (
            <article className={`score-team ${team.win ? 'win-team' : 'loss-team'}`} key={team.teamId}>
              <div className="score-heading">
                <strong>{team.win ? '승리' : '패배'} 팀</strong>
                <span>포탑 {team.towerKills} · 억제기 {team.inhibitorKills}</span>
              </div>
              <div className="score-header-row">
                <span>소환사</span>
                <span>OP Score</span>
                <span>KDA</span>
                <span>피해량</span>
                <span>CS</span>
                <span>아이템</span>
              </div>
              <div className="score-table">
                {team.players.map((player) => (
                  <div className={`score-row ${player.isCurrentSummoner ? 'me' : ''}`} key={player.participantId}>
                    <div className="player-cell">
                      <ChampionIcon championId={player.championId} />
                      <div className="spell-cell">
                        {player.spells?.map((spell) => <SpellIcon spell={spell} key={spell.id} />)}
                      </div>
                      {player.augments?.length > 0 && (
                        <div className="player-augment-row">
                          {player.augments.map((augment) => <AugmentIcon augment={augment} key={augment.id} />)}
                        </div>
                      )}
                      <div>
                        <strong>{player.riotId}</strong>
                        <span>{player.champion} · Lv.{player.level}</span>
                      </div>
                    </div>
                    <div className="op-score-cell">
                      <strong>{calculateOpScore(player, maxDamage)}</strong>
                      <span className={getRankClass(team.players, player, team.win, maxDamage)}>
                        {getRankLabel(team.players, player, team.win, maxDamage)}
                      </span>
                    </div>
                    <div className="score-kda">
                      <strong>{player.kills} / {player.deaths} / {player.assists}</strong>
                      <span>{player.killParticipation ?? 0}%</span>
                      <em>{player.kdaRatio}:1</em>
                    </div>
                    <div className="damage-cell">
                      <div>
                        <span>{formatNumber(player.damage)}</span>
                        <span>{formatNumber(player.taken)}</span>
                      </div>
                      <div className="damage-bars">
                        <i className="damage-dealt" style={{ width: `${Math.max((player.damage / maxDamage) * 100, 4)}%` }} />
                        <i className="damage-taken" style={{ width: `${Math.max((player.taken / maxTaken) * 100, 4)}%` }} />
                      </div>
                    </div>
                    <div className="cs-cell">
                      <strong>{player.cs}</strong>
                      <span>{formatNumber(player.gold)}G</span>
                    </div>
                    <div className="item-row compact">
                      {player.items.map((item) => (
                        <ItemIcon item={item} key={item.id} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
      <DamageChart teams={detail.teams} />
    </section>
  );
}

function calculateOpScore(player, maxDamage) {
  const kdaScore = player.deaths === 0
    ? player.kills + player.assists
    : (player.kills + player.assists) / player.deaths;
  const damageScore = player.damage / Math.max(maxDamage, 1);
  return Math.min(10, Math.max(1, kdaScore * 0.9 + damageScore * 3)).toFixed(1);
}

function getRankLabel(players, player, teamWin, maxDamage) {
  const ranked = [...players]
    .sort((a, b) => Number(calculateOpScore(b, maxDamage)) - Number(calculateOpScore(a, maxDamage)));
  const index = ranked.findIndex((item) => item.participantId === player.participantId);
  if (index === 0) return teamWin ? 'MVP' : 'ACE';
  if (index === 1) return '2nd';
  if (index === 2) return '3rd';
  return `${index + 1}th`;
}

function getRankClass(players, player, teamWin, maxDamage) {
  const label = getRankLabel(players, player, teamWin, maxDamage);
  if (label === 'MVP') return 'rank-badge mvp';
  if (label === 'ACE') return 'rank-badge ace';
  if (label === '2nd' || label === '3rd') return 'rank-badge high';
  return 'rank-badge';
}

function assetUrl(path) {
  return `/api/lcu/asset?path=${encodeURIComponent(path)}`;
}

function ChampionIcon({ championId, className = 'champion-icon' }) {
  return <img className={className} alt="" src={assetUrl(`/lol-game-data/assets/v1/champion-icons/${championId}.png`)} />;
}

function ItemIcon({ item }) {
  if (!item.iconPath) return <span className="empty-item" />;
  return <HoverTooltip info={item}><img alt={item.name || '아이템'} src={assetUrl(item.iconPath)} /></HoverTooltip>;
}

function SpellIcon({ spell }) {
  if (!spell.iconPath) return <span className="empty-spell" />;
  return <HoverTooltip info={spell}><img className="spell-icon" alt={spell.name || '스펠'} src={assetUrl(spell.iconPath)} /></HoverTooltip>;
}

function AugmentIcon({ augment }) {
  const rarityClass = getRarityClass(augment.rarity);
  const rarityName = getRarityName(augment.rarity);
  const info = { ...augment, description: [rarityName, augment.description].filter(Boolean).join(' · ') };
  if (!augment.iconPath) return <span className={`empty-augment ${rarityClass}`}>?</span>;
  return <HoverTooltip info={info}><img className={`augment-icon ${rarityClass}`} alt={augment.name || '증강'} src={assetUrl(augment.iconPath)} /></HoverTooltip>;
}

function getRarityClass(rarity) {
  const value = String(rarity || '').toLowerCase();
  if (value.includes('prismatic')) return 'rarity-prismatic';
  if (value.includes('gold')) return 'rarity-gold';
  if (value.includes('silver')) return 'rarity-silver';
  if (value.includes('bronze')) return 'rarity-bronze';
  return 'rarity-unknown';
}

function getRarityName(rarity) {
  const labels = {
    'rarity-prismatic': '프리즘 증강',
    'rarity-gold': '골드 증강',
    'rarity-silver': '실버 증강',
    'rarity-bronze': '브론즈 증강',
  };
  return labels[getRarityClass(rarity)] || '증강';
}

function HoverTooltip({ info, children }) {
  const [position, setPosition] = useState(null);

  function updatePosition(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ left: rect.left + (rect.width / 2), top: rect.top - 8 });
  }

  return (
    <span className="tooltip-trigger" tabIndex={0} onMouseEnter={updatePosition} onFocus={updatePosition}>
      {children}
      <span
        className="hover-tooltip"
        role="tooltip"
        style={position ? { left: position.left, top: position.top } : undefined}
      >
        <strong>{info.name || '정보 없음'}</strong>
        {info.description && <small>{info.description}</small>}
      </span>
    </span>
  );
}

function MatchPreview({ match }) {
  if (!match.championId) return null;

  return (
    <div className="match-preview" aria-label="경기 요약 구성">
      <div className="preview-loadout">
        <div className="preview-champion">
          <ChampionIcon championId={match.championId} className="preview-champion-icon" />
          <span>{match.level}</span>
        </div>
        <div className="preview-group preview-spells">
          <span className="preview-label">스펠</span>
          <div className="preview-spell-icons">
            {match.spells?.map((spell) => <SpellIcon spell={spell} key={spell.id} />)}
          </div>
        </div>
        <div className="preview-group preview-items">
          <span className="preview-label">아이템</span>
          <div className="preview-item-icons">
            {match.items?.map((item) => <ItemIcon item={item} key={item.id} />)}
          </div>
        </div>
        {match.augments?.length > 0 && (
          <div className="preview-group preview-augments">
            <span className="preview-label">증강</span>
            <div className="preview-augment-icons">
              {match.augments.map((augment) => <AugmentIcon augment={augment} key={augment.id} />)}
            </div>
          </div>
        )}
      </div>
      {match.teams?.length > 0 && (
        <div className="preview-rosters">
          {match.teams.map((team) => {
            const opponents = team.players.filter((player) => !player.isCurrentSummoner);
            if (opponents.length === 0) return null;
            return (
            <div className={`roster-column ${team.win ? 'winner' : ''}`} key={team.teamId}>
              {opponents.map((player, index) => (
                <div className="roster-player" key={`${team.teamId}-${index}`}>
                  <ChampionIcon championId={player.championId} className="roster-champion-icon" />
                  <span title={player.riotId}>{player.riotId}</span>
                  {player.augments?.length > 0 && (
                    <div className="roster-augment-row">
                      {player.augments.map((augment) => <AugmentIcon augment={augment} key={augment.id} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DamageChart({ teams }) {
  const players = teams.flatMap((team) => team.players.map((player) => ({
    ...player,
    teamWin: team.win,
  })));
  const maxDamage = Math.max(...players.map((player) => player.damage), 1);

  return (
    <section className="damage-chart" aria-label="챔피언에게 입힌 피해량 그래프">
      <div className="section-heading">
        <Swords size={18} />
        <h2>피해량 그래프</h2>
      </div>
      <div className="chart-list">
        {players.map((player) => (
          <div className="chart-row" key={player.participantId}>
            <div className={`champion-dot ${player.teamWin ? 'ally' : 'enemy'}`}>{player.champion.slice(0, 1)}</div>
            <div className="chart-track">
              <div
                className={player.teamWin ? 'ally-bar' : 'enemy-bar'}
                style={{ width: `${Math.max((player.damage / maxDamage) * 100, 3)}%` }}
              />
            </div>
            <strong>{formatNumber(player.damage)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function StateMessage({ title, body }) {
  return (
    <section className="state-message">
      <Clock size={22} />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </section>
  );
}

function SummaryCard({ icon, label, value, detail }) {
  return (
    <article className="summary-card">
      <div className="summary-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getEmptyMessage(data) {
  const diagnostic = data?.diagnostic;
  const account = data?.account;
  const accountNote = account?.summonerLevel ? `계정 확인: 레벨 ${account.summonerLevel}. ` : '';

  if (!diagnostic?.checked) {
    return `${accountNote}공식 Match-V5 매치 목록이 0건입니다. 아수라장 전적이 공개 Match-V5에 포함되지 않는 상태일 수 있습니다.`;
  }

  const queues = Object.entries(diagnostic.queueCounts || {})
    .map(([queueId, count]) => `${queueId}: ${count}게임`)
    .join(', ');

  return `${accountNote}공식 Match-V5 일반 매치 최근 ${diagnostic.checked}경기 기준 queueId 2400이 없습니다. 최신 공식 일반 매치는 ${diagnostic.latestPlayedAt}, queueId ${diagnostic.latestQueueId}입니다. 확인된 큐: ${queues}`;
}

function ExplorePanel({ data }) {
  const queues = Object.entries(data.queueCounts || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([queueId, count]) => `${queueId}: ${count}`)
    .join(', ');

  return (
    <section className="explore-panel">
      <div className="section-heading">
        <Database size={20} />
        <h2>최근 매치 큐 탐색</h2>
      </div>
      <p className="explore-summary">
        공식 Match-V5 최근 {data.count}경기 기준 확인된 큐: {queues || '없음'}
      </p>
      <div className="explore-table-wrap">
        <table className="explore-table">
          <thead>
            <tr>
              <th>일시</th>
              <th>큐</th>
              <th>모드</th>
              <th>맵</th>
              <th>챔피언</th>
              <th>결과</th>
              <th>KDA</th>
              <th>매치</th>
            </tr>
          </thead>
          <tbody>
            {data.matches.map((match) => (
              <tr className={match.queueId === 2400 ? 'mayhem-row' : ''} key={match.id}>
                <td>{match.playedAt}</td>
                <td>{match.queueId}</td>
                <td>{match.gameMode}</td>
                <td>{match.mapName} ({match.mapId})</td>
                <td>{match.champion}</td>
                <td>{match.win === null ? '-' : match.win ? '승리' : '패배'}</td>
                <td>{match.kda}</td>
                <td>{match.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
