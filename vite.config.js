import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { existsSync, readFileSync } from 'node:fs';

const MAYHEM_QUEUE_ID = 2400;
const MATCH_REGION = 'asia';
const PLATFORM_REGION = 'kr';
const MAYHEM_GAME_MODE = 'KIWI';

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    build: {
      outDir: 'web-dist',
    },
    plugins: [
      react(),
      {
        name: 'riot-api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (
              !req.url?.startsWith('/api/mayhem') &&
              !req.url?.startsWith('/api/explore') &&
              !req.url?.startsWith('/api/lcu/mayhem') &&
              !req.url?.startsWith('/api/lcu/asset')
            ) {
              next();
              return;
            }

            try {
              if (req.url.startsWith('/api/lcu/asset')) {
                await proxyLcuAsset(req, res);
                return;
              }

              if (req.url.startsWith('/api/lcu/mayhem')) {
                const url = new URL(req.url, 'http://localhost');
                const detailMatch = url.pathname.match(/^\/api\/lcu\/mayhem\/KR_(\d+)$/);
                if (detailMatch) {
                  const payload = await getLcuMayhemDetail(detailMatch[1]);
                  sendJson(res, 200, payload);
                  return;
                }

                const count = clampNumber(url.searchParams.get('count'), 1, 40, 20);
                const payload = await getLcuMayhemMatches(count);
                sendJson(res, 200, payload);
                return;
              }

              const key = process.env.RIOT_API_KEY?.trim();
              if (!key) {
                sendJson(res, 500, {
                  message: '.env에 RIOT_API_KEY를 넣고 개발 서버를 다시 시작해야 실제 전적을 볼 수 있습니다.',
                });
                return;
              }

              const url = new URL(req.url, 'http://localhost');
              const riotId = url.searchParams.get('riotId') || '';
              const [gameName, tagLine] = riotId.split('#').map((part) => part?.trim());

              if (!gameName || !tagLine) {
                sendJson(res, 400, { message: 'Riot ID는 닉네임#태그 형식이어야 합니다.' });
                return;
              }

              const account = await riotFetch(
                `https://${MATCH_REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
                key,
              );
              const summoner = await riotFetch(
                `https://${PLATFORM_REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`,
                key,
              );

              if (url.pathname === '/api/explore') {
                const start = clampNumber(url.searchParams.get('start'), 0, 200, 0);
                const count = clampNumber(url.searchParams.get('count'), 1, 60, 40);
                const ids = await riotFetch(
                  `https://${MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=${start}&count=${count}`,
                  key,
                );
                const details = await fetchMatchDetails(ids, key);

                sendJson(res, 200, {
                  account: {
                    gameName: account.gameName,
                    tagLine: account.tagLine,
                    puuid: account.puuid,
                    platform: PLATFORM_REGION,
                    summonerLevel: summoner.summonerLevel,
                    profileIconId: summoner.profileIconId,
                  },
                  start,
                  count: ids.length,
                  matches: details.map((match) => toExploreSummary(match, account.puuid)),
                  queueCounts: countQueues(details),
                  updatedAt: new Intl.DateTimeFormat('ko-KR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: 'Asia/Seoul',
                  }).format(new Date()),
                });
                return;
              }

              let diagnostic = null;
              const ids = await riotFetch(
                `https://${MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=${MAYHEM_QUEUE_ID}&type=normal&start=0&count=20`,
                key,
              );

              const details = await fetchMatchDetails(ids, key);

              const matches = details
                .map((match) => toMatchSummary(match, account.puuid))
                .filter(Boolean);

              if (matches.length === 0) {
                diagnostic = await getRecentDiagnostic(account.puuid, key);
              }

              sendJson(res, 200, {
                account: {
                  gameName: account.gameName,
                  tagLine: account.tagLine,
                  puuid: account.puuid,
                  platform: PLATFORM_REGION,
                  summonerLevel: summoner.summonerLevel,
                  profileIconId: summoner.profileIconId,
                },
                queueId: MAYHEM_QUEUE_ID,
                diagnostic,
                updatedAt: new Intl.DateTimeFormat('ko-KR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'Asia/Seoul',
                }).format(new Date()),
                matches,
              });
            } catch (err) {
              sendJson(res, err.status || 500, {
                message: err.message || 'Riot API 조회 중 오류가 발생했습니다.',
              });
            }
          });
        },
      },
    ],
  };
});

async function riotFetch(url, key) {
  const response = await fetch(url, {
    headers: {
      'X-Riot-Token': key,
    },
  });

  if (!response.ok) {
    const detail = await readError(response);
    const error = new Error(detail || `Riot API 오류: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

export async function getLcuMayhemDetail(gameId) {
  const client = createLcuClient();
  const currentSummoner = await client.fetchJson('/lol-summoner/v1/current-summoner');
  const game = await client.fetchJson(`/lol-match-history/v1/games/${gameId}`);
  const championNames = new Map();
  const itemPaths = await getLcuItemPaths(client);
  const spellPaths = await getLcuSpellPaths(client);
  const augmentPaths = await getLcuAugmentPaths(client);

  return {
    source: 'LCU',
    account: {
      gameName: currentSummoner.gameName,
      tagLine: currentSummoner.tagLine,
      puuid: currentSummoner.puuid,
    },
    game: {
      id: `KR_${game.gameId}`,
      modeName: getModeName(game.gameMode),
      gameMode: game.gameMode,
      mapName: getLcuMapName(game),
      duration: formatDuration(game.gameDuration || 0),
      playedAt: formatFullPlayedAt(game.gameCreation),
      version: game.gameVersion,
    },
    teams: await Promise.all(
      (game.teams || []).map(async (team) => ({
        teamId: team.teamId,
        win: team.win === 'Win',
        towerKills: team.towerKills || 0,
        inhibitorKills: team.inhibitorKills || 0,
        players: await Promise.all(
          (game.participants || [])
            .filter((participant) => participant.teamId === team.teamId)
            .map((participant) => toLcuDetailPlayer(participant, game, currentSummoner, client, championNames, itemPaths, spellPaths, augmentPaths, team)),
        ),
      })),
    ),
  };
}

export async function getLcuMayhemMatches(count) {
  const client = createLcuClient();
  const currentSummoner = await client.fetchJson('/lol-summoner/v1/current-summoner');
  const history = await client.fetchJson(
    `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${count}`,
  );
  const games = history?.games?.games || [];
  const championNames = new Map();
  const itemPaths = await getLcuItemPaths(client);
  const spellPaths = await getLcuSpellPaths(client);
  const augmentPaths = await getLcuAugmentPaths(client);

  const matches = [];
  for (const game of games) {
    if (game.gameMode !== MAYHEM_GAME_MODE) continue;

    const summary = await toLcuMatchSummary(game, currentSummoner, client, championNames, itemPaths, spellPaths, augmentPaths);
    if (summary) matches.push(summary);
  }

  return {
    source: 'LCU',
    account: {
      gameName: currentSummoner.gameName,
      tagLine: currentSummoner.tagLine,
      puuid: currentSummoner.puuid,
      summonerLevel: currentSummoner.summonerLevel,
      profileIconId: currentSummoner.profileIconId,
    },
    queueId: MAYHEM_QUEUE_ID,
    gameMode: MAYHEM_GAME_MODE,
    checked: games.length,
    updatedAt: new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Seoul',
    }).format(new Date()),
    matches,
  };
}

function createLcuClient() {
  const lockfilePath = findLockfile();
  if (!lockfilePath) {
    const error = new Error('롤 클라이언트가 실행 중이어야 클라이언트 전적을 가져올 수 있습니다.');
    error.status = 503;
    throw error;
  }

  const [, , port, password, protocol] = readFileSync(lockfilePath, 'utf8').trim().split(':');
  const auth = Buffer.from(`riot:${password}`).toString('base64');

  return {
    async fetchJson(path) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      const response = await fetch(`${protocol}://127.0.0.1:${port}${path}`, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });

      if (!response.ok) {
        const error = new Error(`LCU API 오류: ${response.status}`);
        error.status = response.status;
        throw error;
      }

      return response.json();
    },
  };
}

function findLockfile() {
  const candidates = [
    process.env.LCU_LOCKFILE,
    'C:\\Riot Games\\League of Legends\\lockfile',
    'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
    'D:\\Riot Games\\League of Legends\\lockfile',
  ].filter(Boolean);

  return candidates.find((path) => existsSync(path)) || null;
}

async function toLcuMatchSummary(game, summoner, client, championNames, itemPaths, spellPaths, augmentPaths) {
  const identity = game.participantIdentities?.find((item) => item.player?.puuid === summoner.puuid);
  if (!identity) return null;

  const participant = game.participants?.find((item) => item.participantId === identity.participantId);
  if (!participant) return null;

  const stats = participant.stats || {};
  const teamId = participant.teamId || (participant.participantId <= 5 ? 100 : 200);
  const team = game.teams?.find((item) => item.teamId === teamId);
  const teamParticipantIds = game.participants
    ?.filter((item) => (item.teamId || (item.participantId <= 5 ? 100 : 200)) === teamId)
    .map((item) => item.participantId) || [];
  const hasFullParticipants = (game.participants?.length || 0) >= 10;
  const teamKills = hasFullParticipants
    ? game.participants
      ?.filter((item) => teamParticipantIds.includes(item.participantId))
      .reduce((sum, item) => sum + (item.stats?.kills || 0), 0) || 0
    : 0;
  const killParticipation = teamKills
    ? Math.round((((stats.kills || 0) + (stats.assists || 0)) / teamKills) * 100)
    : null;
  const champion = await getLcuChampionName(participant.championId, client, championNames);
  const items = [stats.item0, stats.item1, stats.item2, stats.item3, stats.item4, stats.item5, stats.item6]
    .filter((itemId) => itemId && itemId !== 0)
    .map((itemId) => ({ id: itemId, ...(itemPaths.get(itemId) || {}) }));
  const spells = [participant.spell1Id, participant.spell2Id]
    .filter(Boolean)
    .map((spellId) => ({ id: spellId, ...(spellPaths.get(spellId) || {}) }));
  const augments = Object.entries(stats)
    .filter(([key, value]) => key.startsWith('playerAugment') && value && value !== 0)
    .map(([, augmentId]) => ({ id: augmentId, ...(augmentPaths.get(augmentId) || augmentPaths.get(String(augmentId)) || {}) }));
  const teams = (game.teams || []).map((gameTeam) => ({
    teamId: gameTeam.teamId,
    win: gameTeam.win === 'Win',
    players: (game.participants || [])
      .filter((player) => (player.teamId || (player.participantId <= 5 ? 100 : 200)) === gameTeam.teamId)
      .map((player) => {
        const playerIdentity = game.participantIdentities?.find((item) => item.participantId === player.participantId);
        const playerAugments = Object.entries(player.stats || {})
          .filter(([key, value]) => key.startsWith('playerAugment') && value && value !== 0)
          .map(([, augmentId]) => ({
            id: augmentId,
            ...(augmentPaths.get(augmentId) || augmentPaths.get(String(augmentId)) || {}),
          }));
        return {
          championId: player.championId,
          riotId: playerIdentity?.player?.gameName || '-',
          isCurrentSummoner: playerIdentity?.player?.puuid === summoner.puuid,
          augments: playerAugments,
        };
      }),
  }));

  return {
    id: `KR_${game.gameId}`,
    modeName: getModeName(game.gameMode),
    champion,
    level: stats.champLevel || 0,
    win: team?.win === 'Win' || stats.win === true,
    playedAt: formatPlayedAt(game.gameCreation),
    duration: formatDuration(game.gameDuration || 0),
    mapName: getLcuMapName(game),
    kills: stats.kills || 0,
    deaths: stats.deaths || 0,
    assists: stats.assists || 0,
    kdaRatio: calculateKda(stats.kills || 0, stats.deaths || 0, stats.assists || 0),
    damage: stats.totalDamageDealtToChampions || 0,
    taken: stats.totalDamageTaken || 0,
    gold: stats.goldEarned || 0,
    cs: (stats.totalMinionsKilled || 0) + (stats.neutralMinionsKilled || 0),
    championId: participant.championId,
    items,
    spells,
    augments,
    teams,
    killParticipation,
    chaos: calculateChaos(
      {
        kills: stats.kills || 0,
        assists: stats.assists || 0,
        deaths: stats.deaths || 0,
        totalDamageDealtToChampions: stats.totalDamageDealtToChampions || 0,
      },
      killParticipation,
      game.gameDuration || 0,
    ),
  };
}

async function toLcuDetailPlayer(participant, game, currentSummoner, client, championNames, itemPaths = new Map(), spellPaths = new Map(), augmentPaths = new Map(), team = null) {
  const identity = game.participantIdentities?.find((item) => item.participantId === participant.participantId);
  const stats = participant.stats || {};
  const champion = await getLcuChampionName(participant.championId, client, championNames);
  const itemIds = [stats.item0, stats.item1, stats.item2, stats.item3, stats.item4, stats.item5, stats.item6]
    .filter((itemId) => itemId && itemId !== 0);
  const teamKills = (game.participants || [])
    .filter((item) => item.teamId === participant.teamId)
    .reduce((sum, item) => sum + (item.stats?.kills || 0), 0);
  const killParticipation = teamKills
    ? Math.round((((stats.kills || 0) + (stats.assists || 0)) / teamKills) * 100)
    : null;
  const augments = Object.entries(stats)
    .filter(([key, value]) => key.startsWith('playerAugment') && value && value !== 0)
    .map(([, augmentId]) => ({ id: augmentId, ...(augmentPaths.get(augmentId) || augmentPaths.get(String(augmentId)) || {}) }));

  return {
    participantId: participant.participantId,
    riotId: `${identity?.player?.gameName || '-'}#${identity?.player?.tagLine || '-'}`,
    isCurrentSummoner: identity?.player?.puuid === currentSummoner.puuid,
    champion,
    championId: participant.championId,
    level: stats.champLevel || 0,
    kills: stats.kills || 0,
    deaths: stats.deaths || 0,
    assists: stats.assists || 0,
    kdaRatio: calculateKda(stats.kills || 0, stats.deaths || 0, stats.assists || 0),
    killParticipation,
    damage: stats.totalDamageDealtToChampions || 0,
    taken: stats.totalDamageTaken || 0,
    gold: stats.goldEarned || 0,
    cs: (stats.totalMinionsKilled || 0) + (stats.neutralMinionsKilled || 0),
    items: itemIds.map((itemId) => ({ id: itemId, ...(itemPaths.get(itemId) || {}) })),
    spells: [participant.spell1Id, participant.spell2Id]
      .filter(Boolean)
      .map((spellId) => ({ id: spellId, ...(spellPaths.get(spellId) || {}) })),
    augments,
  };
}

async function getLcuItemPaths(client) {
  const items = await client.fetchJson('/lol-game-data/assets/v1/items.json');
  return new Map(items.map((item) => [item.id, {
    name: item.name || `아이템 ${item.id}`,
    description: toPlainText(item.description),
    iconPath: item.iconPath || null,
  }]));
}

async function getLcuSpellPaths(client) {
  const spells = await client.fetchJson('/lol-game-data/assets/v1/summoner-spells.json');
  return new Map(spells.map((spell) => [spell.id, {
    name: spell.name || `스펠 ${spell.id}`,
    description: toPlainText(spell.description),
    iconPath: spell.iconPath || null,
  }]));
}

async function getLcuAugmentPaths(client) {
  try {
    // 아수라장/투기장 계열 증강은 일반 augments.json이 아니라
    // cherry-augments.json에 등록되어 있다.
    const cherryAugments = await client.fetchJson('/lol-game-data/assets/v1/cherry-augments.json');
    return new Map(cherryAugments.flatMap((augment) => {
      const value = {
        name: augment.nameTRA || augment.simpleNameTRA || augment.name || augment.augmentName || augment.displayName || augment.apiName || `증강 ${augment.id}`,
        description: toPlainText(augment.descriptionTRA || augment.description || augment.augmentDescription || augment.tooltip || augment.longDescription),
        iconPath: augment.iconPath || augment.augmentSmallIconPath || augment.smallIconPath || augment.icon || null,
        rarity: augment.rarity || null,
      };
      return [[augment.id, value], [String(augment.id), value]];
    }));
  } catch {
    return new Map();
  }
}

function toPlainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getLcuChampionName(championId, client, championNames) {
  if (championNames.has(championId)) return championNames.get(championId);

  try {
    const champion = await client.fetchJson(`/lol-game-data/assets/v1/champions/${championId}.json`);
    championNames.set(championId, champion.name || `챔피언 ${championId}`);
  } catch {
    championNames.set(championId, `챔피언 ${championId}`);
  }

  return championNames.get(championId);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function countQueues(details) {
  return details.reduce((counts, match) => {
    const queueId = match.info.queueId;
    counts[queueId] = (counts[queueId] || 0) + 1;
    return counts;
  }, {});
}

async function getRecentDiagnostic(puuid, key) {
  const ids = await riotFetch(
    `https://${MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?type=normal&start=0&count=8`,
    key,
  );
  const details = await fetchMatchDetails(ids, key);

  const queueCounts = details.reduce((counts, match) => {
    const queueId = match.info.queueId;
    counts[queueId] = (counts[queueId] || 0) + 1;
    return counts;
  }, {});
  const latest = details[0];

  return {
    checked: details.length,
    latestMatchId: latest?.metadata?.matchId || null,
    latestPlayedAt: latest ? formatFullPlayedAt(latest.info.gameStartTimestamp) : null,
    latestQueueId: latest?.info?.queueId || null,
    queueCounts,
  };
}

async function fetchMatchDetails(ids, key) {
  const details = [];

  for (const id of ids) {
    details.push(await riotFetch(`https://${MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/${id}`, key));
    await delay(120);
  }

  return details;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readError(response) {
  try {
    const payload = await response.json();
    if (payload?.status?.message === 'Unknown apikey') {
      return 'Riot API 키가 유효하지 않거나 만료되었습니다. developer.riotgames.com에서 새 키를 발급받아 .env에 넣고 서버를 재시작하세요.';
    }
    if (payload?.status?.message === 'rate limit exceeded') {
      return 'Riot API 개발 키 호출 제한에 걸렸습니다. 잠시 뒤 다시 검색해 주세요.';
    }
    return payload?.status?.message;
  } catch {
    return response.statusText;
  }
}

function toMatchSummary(match, puuid) {
  const participant = match.info.participants.find((item) => item.puuid === puuid);
  if (!participant) return null;

  const team = match.info.teams.find((item) => item.teamId === participant.teamId);
  const teamKills = match.info.participants
    .filter((item) => item.teamId === participant.teamId)
    .reduce((sum, item) => sum + item.kills, 0);
  const killParticipation = teamKills
    ? Math.round(((participant.kills + participant.assists) / teamKills) * 100)
    : 0;
  const durationSeconds = match.info.gameDuration || 0;

  return {
    id: match.metadata.matchId,
    champion: participant.championName,
    level: participant.champLevel,
    win: Boolean(participant.win ?? team?.win),
    playedAt: formatPlayedAt(match.info.gameStartTimestamp),
    duration: formatDuration(durationSeconds),
    mapName: getMapName(match.info.mapId),
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    kdaRatio: calculateKda(participant.kills, participant.deaths, participant.assists),
    damage: participant.totalDamageDealtToChampions,
    taken: participant.totalDamageTaken,
    gold: participant.goldEarned,
    cs: (participant.totalMinionsKilled || 0) + (participant.neutralMinionsKilled || 0),
    killParticipation,
    chaos: calculateChaos(participant, killParticipation, durationSeconds),
  };
}

function toExploreSummary(match, puuid) {
  const participant = match.info.participants.find((item) => item.puuid === puuid);

  return {
    id: match.metadata.matchId,
    queueId: match.info.queueId,
    gameMode: match.info.gameMode,
    gameType: match.info.gameType,
    mapId: match.info.mapId,
    mapName: getMapName(match.info.mapId),
    champion: participant?.championName || '-',
    win: participant?.win ?? null,
    kda: participant ? `${participant.kills}/${participant.deaths}/${participant.assists}` : '-',
    playedAt: formatFullPlayedAt(match.info.gameStartTimestamp),
    duration: formatDuration(match.info.gameDuration || 0),
  };
}

function calculateKda(kills, deaths, assists) {
  if (deaths === 0) return 'Perfect';
  return ((kills + assists) / deaths).toFixed(2);
}

function calculateChaos(participant, killParticipation, durationSeconds) {
  const minutes = Math.max(durationSeconds / 60, 1);
  const damagePerMinute = participant.totalDamageDealtToChampions / minutes;
  const fightScore = participant.kills * 2 + participant.assists + participant.deaths * 1.5;
  const raw = damagePerMinute / 900 + killParticipation / 2 + fightScore;
  return Math.max(1, Math.min(100, Math.round(raw)));
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatPlayedAt(timestamp) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(new Date(timestamp));
}

function formatFullPlayedAt(timestamp) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(timestamp));
}

function getMapName(mapId) {
  const maps = {
    11: '소환사의 협곡',
    12: '칼바람 나락',
    14: '도살자의 다리',
    30: '코신 다리',
  };
  return maps[mapId] || `map ${mapId}`;
}

function getLcuMapName(game) {
  const mutators = game.gameModeMutators || [];

  if (mutators.includes('mapskin_map12_bloom')) return '코신 다리';
  if (mutators.includes('mapskin_ha_bilgewater')) return '도살자의 다리';

  return getMapName(game.mapId);
}

function getModeName(gameMode) {
  if (gameMode === MAYHEM_GAME_MODE) return '무작위 총력전: 아수라장';
  return gameMode;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function proxyLcuAsset(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.searchParams.get('path');

  try {
    const { contentType, bytes } = await getLcuAsset(path);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(bytes);
  } catch (error) {
    sendJson(res, error.status || 500, { message: error.message });
  }
}

export async function getLcuAsset(path) {
  if (!path?.startsWith('/lol-game-data/assets/')) {
    const error = new Error('허용되지 않은 asset path입니다.');
    error.status = 400;
    throw error;
  }

  const lockfilePath = findLockfile();
  if (!lockfilePath) {
    const error = new Error('롤 클라이언트가 실행 중이어야 에셋을 불러올 수 있습니다.');
    error.status = 503;
    throw error;
  }

  const [, , port, password, protocol] = readFileSync(lockfilePath, 'utf8').trim().split(':');
  const auth = Buffer.from(`riot:${password}`).toString('base64');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const response = await fetch(`${protocol}://127.0.0.1:${port}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!response.ok) {
    const error = new Error(`LCU asset 오류: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return {
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}
