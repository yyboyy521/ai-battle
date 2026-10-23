(() => {
  "use strict";

  /* ═══════════════════════════════════════════════════════
     Helpers & constants
     ═══════════════════════════════════════════════════════ */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const sign = (v) => (v < 0 ? -1 : 1);
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmt = (n, digits = 1) => Number(n).toFixed(digits);

  const W = 1280;
  const H = 720;
  const GROUND_Y = 612;
  const GRAVITY = 2200;
  const CRIT_MULT = 1.7;
  const SKILL_DODGE_FACTOR = 0.35;
  const COUNTER_BONUS = 0.08;
  const RANGED_LIMIT = W / 2;
  const ARENA = { minX: 86, maxX: 1194, wallL: 54, wallR: 1226, top: 128 };
  // 地图：女仆咖啡厅 · 霓虹（背景图与碰撞盒共用这一份坐标）
  const STAGE_IMAGE = "assets/stages/maid_cafe_neon.webp";
  const stageImage = new Image();
  stageImage.decoding = "async";
  stageImage.src = STAGE_IMAGE;
  let stageLoaded = false;
  stageImage.onload = () => { stageLoaded = true; };
  // 三座平台按背景图实测像素定位（1280×720 坐标系），并保证可跳跃：
  //   最矮角色跳跃高度 = 830² / (2×2200) ≈ 156.6px，留出余量取 132px。
  //   中平台  x 518–758, 顶边 y≈480（离地 132px，从地面一跳即上）
  //   左平台  x 202–442, 顶边 y≈410
  //   右平台  x 830–1070, 顶边 y≈410
  // 中央低、左右高，保留"从中央跳上侧翼"的原机制。
  const PLATFORM = { x1: 518, x2: 758, y: 480, h: 12 };
  const SIDE_PLATFORM_WIDTH = 240;
  const SIDE_PLATFORM_LIFT = 70;
  const PLATFORMS = [
    { x1: 202, x2: 202 + SIDE_PLATFORM_WIDTH, y: PLATFORM.y - SIDE_PLATFORM_LIFT, h: PLATFORM.h, kind: "side-left" },
    { ...PLATFORM, kind: "center" },
    { x1: 830, x2: 830 + SIDE_PLATFORM_WIDTH, y: PLATFORM.y - SIDE_PLATFORM_LIFT, h: PLATFORM.h, kind: "side-right" }
  ];

  function platformAt(x, edge = 0) {
    return PLATFORMS.find((p) => x >= p.x1 - edge && x <= p.x2 + edge) || null;
  }

  /* 平台可达性自检：任何平台都必须能被最矮的角色从下方跳上去，
     否则玩家会"跳不上平台"却看不出原因。只在控制台报警，不影响运行。
     注意：此处 CHARACTERS 尚未初始化，所以直接取最矮跳跃初速（830）。 */
  (function assertPlatformsReachable() {
    const lowestJump = 830;
    const maxRise = (lowestJump * lowestJump) / (2 * GRAVITY);
    const center = PLATFORMS.find((p) => p.kind === "center");
    const groundGap = GROUND_Y - center.y;
    const wingGap = center.y - PLATFORMS.find((p) => p.kind === "side-left").y;
    if (maxRise <= groundGap) {
      console.warn(`[map] 地面跳不上中央平台：可跳 ${maxRise.toFixed(1)}px，需要 ${groundGap}px`);
    }
    if (maxRise <= wingGap) {
      console.warn(`[map] 中央平台跳不上侧翼：可跳 ${maxRise.toFixed(1)}px，需要 ${wingGap}px`);
    }
  })();

  // 冲刺距离小幅增加（165.6px → 192px），冷却缩短，方便"CD 好了就冲"的基本操作。
  const DASH_SPEED = 960;
  const DASH_TIME = 0.2;
  const DASH_INVULN = 0.2;
  const DASH_COOLDOWN = 1.0;
  const DASH_BUFFER_TIME = 0.2;
  const STARTING_TOKEN = 20;
  const TOKEN_REGEN_FALL_AT = 10;
  const TOKEN_REGEN_LATE_MULT = 0.5;
  const GPT_RANGE_MULT = 1.6;
  const GPT_RANGE_CHARGES = 3;
  const AI_DIFFICULTIES = {
    easy: {
      label: "轻松",
      decisionMin: 0.34,
      decisionMax: 0.64,
      attackRanged: 0.5,
      attackMelee: 0.72,
      skillChance: 0.3,
      dodgeChance: 0.16,
      jumpAbove: 0.32,
      aimX: 26,
      aimY: 48,
      initialLockout: 2.8,
      skillLockoutMin: 4.2,
      skillLockoutMax: 7.4
    },
    normal: {
      label: "标准",
      decisionMin: 0.2,
      decisionMax: 0.4,
      attackRanged: 0.7,
      attackMelee: 0.88,
      skillChance: 0.46,
      dodgeChance: 0.3,
      jumpAbove: 0.44,
      aimX: 16,
      aimY: 28,
      initialLockout: 2.2,
      skillLockoutMin: 3.2,
      skillLockoutMax: 5.4
    },
    hard: {
      label: "困难",
      decisionMin: 0.16,
      decisionMax: 0.34,
      attackRanged: 0.76,
      attackMelee: 0.9,
      skillChance: 0.54,
      dodgeChance: 0.34,
      jumpAbove: 0.58,
      aimX: 10,
      aimY: 18,
      initialLockout: 1.7,
      skillLockoutMin: 2.4,
      skillLockoutMax: 4.0
    }
  };
  const FONT = '"Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  const DISPLAY = '"Segoe UI Variable Display", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  /* ═══════════════════════════════════════════════════════
     Fighter data — every displayed number comes from here
     ═══════════════════════════════════════════════════════ */
  const CHARACTERS = [
    {
      id: "deepseek",
      name: "DeepSeek",
      title: "白饭鲸娘",
      role: "均衡 · 近战",
      meme: "干饭魂",
      quote: "“干饭第一，战斗第二。”",
      subline: "“白饭不能少。”",
      serial: "DS // 001",
      color: "#63b5ff",
      accentRgb: "99, 181, 255",
      image: "assets/chars/deepseek.webp",
      battleHeight: 238,
      // 移动帧：AI 生成的左右行走精灵图（横向条带，12 帧，每格 160×160）
      walk: {
        sheet: "assets/chars/deepseek_walk_{dir}.webp",
        frames: 12,
        cell: 160,
        fps: 12,
        // 格子内人物高度占格子的比例，用来换算到 battleHeight
        heightRatio: 0.92
      },
      counter: "kimi",
      matchup: "贴身打断 Kimi 的长读条。",
      hpMax: 1060,
      tokenMax: 100,
      tokenRegen: 10.5,
      crit: 0.18,
      dodge: 0.08,
      speed: 334,
      jump: 838,
      aiRange: 174,
      passive: {
        name: "开源省流",
        desc: "生命首次低于 45% 后开启开源省流模式：此后移动速度 +10%、普攻范围 +50%、造成伤害 +15%，并获得 1 秒无敌（每场一次）。开源的孩子会自己省着用。",
        shortDesc: "首次低于 45% 生命：移速 +10%、普攻范围 +50%、伤害 +15%，并获得 1 秒无敌。",
        type: "deepseek",
        speedBonus: 0.1,
        rangeBonus: 0.5,
        damageBonus: 0.15,
        invulnDuration: 1
      },
      normal: {
        name: "鲸尾扫饭",
        type: "melee",
        flavor: "甩动蓝鲸长尾横扫近身目标。",
        damage: 36,
        cooldown: 0.5,
        windup: 0.09,
        duration: 0.29,
        range: 210,
        knockback: 250
      },
      skill: {
        name: "白饭管饱",
        meme: "干饭人干饭魂",
        flavor: "锁定对手附近，横向排开三碗巨型白饭。",
        type: "rice",
        cost: 48,
        cooldown: 6,
        damage: 118,
        radius: 124,
        bowlCount: 3,
        bowlSpacing: 156,
        warning: 0.75,
        windup: 0.34,
        duration: 0.78,
        knockback: 380
      }
    },
    {
      id: "gpt",
      name: "GPT",
      title: "纯白龙娘",
      role: "远程 · 爆发",
      meme: "小作文风暴",
      quote: "“答案很长，你忍一下。”",
      subline: "“正在写第十万字。”",
      serial: "OA // 002",
      color: "#d9d2ff",
      accentRgb: "217, 210, 255",
      image: "assets/chars/gpt.webp",
      battleHeight: 248,
      // 移动帧：AI 生成的左右行走精灵图（横向条带，12 帧，每格 160×160）
      walk: {
        sheet: "assets/chars/gpt_walk_{dir}.webp",
        frames: 12,
        cell: 160,
        fps: 12,
        heightRatio: 0.92
      },
      counter: "claude",
      matchup: "远程拉扯 Claude 的短手。",
      hpMax: 890,
      tokenMax: 100,
      tokenRegen: 9,
      crit: 0.12,
      dodge: 0.07,
      speed: 338,
      jump: 838,
      aiRange: 355,
      passive: {
        name: "服务器重启",
        desc: "生命即将耗尽时，一场战斗一次：立刻回复 15% 生命，刷新技能冷却并回复 40 TOKEN；15 秒后会强制损失 10% 最大生命。服务器繁忙，但会自己重启。",
        shortDesc: "致命伤时：回复 15% 生命、刷新技能、+40 TOKEN；15s 后反噬 -10% 最大生命（每场一次）。",
        type: "gpt",
        reviveRatio: 0.15,
        tokenRefund: 40,
        backlashDelay: 15,
        backlashRatio: 0.1
      },
      normal: {
        name: "白羽小作文",
        type: "projectile",
        flavor: "弹出一片纯白羽刃，沿直线讲道理。",
        damage: 32,
        cooldown: 0.62,
        windup: 0.11,
        duration: 0.28,
        knockback: 210,
        projectile: { speed: 860, w: 48, h: 22 }
      },
      skill: {
        name: "万字小作文",
        meme: "请稍后再试",
        flavor: "向前推出一整卷无法折叠的小作文。",
        type: "scroll",
        cost: 50,
        cooldown: 8.5,
        damage: 108,
        windup: 0.28,
        duration: 0.62,
        knockback: 1800,
        lifesteal: 0.3,
        lifestealDuration: 2,
        projectile: { speed: 825, w: 190, h: 104, life: 2.6 }
      }
    },
    {
      id: "kimi",
      name: "Kimi",
      title: "月读歌姬",
      role: "远程 · 消耗",
      meme: "全都记得",
      quote: "“你说过的，我都记得。”",
      subline: "“两百万字上下文。”",
      serial: "MO // 003",
      color: "#a9c0ff",
      accentRgb: "169, 192, 255",
      image: "assets/chars/kimi.webp",
      battleHeight: 242,
      // 移动帧：AI 生成的左右行走精灵图（横向条带，12 帧，每格 160×160）
      walk: {
        sheet: "assets/chars/kimi_walk_{dir}.webp",
        frames: 12,
        cell: 160,
        fps: 12,
        heightRatio: 0.92
      },
      counter: "gpt",
      matchup: "长光束压制 GPT 的羽刃。",
      hpMax: 880,
      tokenMax: 100,
      tokenRegen: 10.8,
      crit: 0.16,
      dodge: 0.11,
      speed: 344,
      jump: 855,
      aiRange: 497,
      attackRangeBonus: 0.26,
      passive: {
        name: "长文护体",
        desc: "TOKEN 不低于 60 时进入护体：受到<b>近战伤害降低 33%</b>，<b>远程伤害降低 23%</b>。每场一次：首次进入该状态时，额外获得一次伤害减免，该次受击再降低 23%（可与护体叠加）。两百万字上下文，也是两百万层护甲。",
        shortDesc: "TOKEN ≥ 60 时：近战伤害 -33%、远程伤害 -23%；每场一次，首次进入时再额外减免一次。",
        type: "kimi",
        tokenThreshold: 60,
        damageReduction: 0.23,        // 远程减伤
        meleeDamageReduction: 0.33,   // 近战减伤
        // 每场一次：首次进入"长文护体"状态时，下一次受到的伤害再减一次
        firstEntryBlock: true,
        blockReduction: 0.23
      },
      normal: {
        name: "月音符",
        type: "projectile",
        flavor: "甩出一枚轻盈的月音符，命中后会留在记忆里。",
        damage: 27,
        cooldown: 0.37,
        windup: 0.08,
        duration: 0.20,
        knockback: 180,
        projectile: { speed: 1162, w: 42, h: 32 }
      },
      skill: {
        name: "两百万字上下文",
        meme: "看完再回答",
        flavor: "向对手方向释放横跨半场的超长上下文光束。",
        type: "beam",
        cost: 54,
        cooldown: 7.5,
        damage: 108,
        beamHeight: 44,
        warning: 0.75,
        windup: 0.5,
        duration: 0.9,
        knockback: 280
      }
    },
    {
      id: "claude",
      name: "Claude",
      title: "橙焰执事",
      role: "中距 · 控制",
      meme: "封号警告",
      quote: "“违规，封号。”",
      subline: "“这是条款。”",
      serial: "AN // 004",
      color: "#ff9a63",
      accentRgb: "255, 154, 99",
      image: "assets/chars/claude.webp",
      battleHeight: 242,
      // 移动帧：AI 生成的左右行走精灵图（横向条带，12 帧，每格 160×160）
      walk: {
        sheet: "assets/chars/claude_walk_{dir}.webp",
        frames: 12,
        cell: 160,
        fps: 12,
        heightRatio: 0.92
      },
      counter: "doubao",
      matchup: "封号克制豆包的高闪避。",
      hpMax: 960,
      tokenMax: 100,
      tokenRegen: 9.5,
      crit: 0.16,
      dodge: 0.07,
      speed: 326,
      jump: 830,
      aiRange: 285,
      passive: {
        name: "合规审查",
        desc: "普通攻击命中后，若审查已就绪，使目标移动速度降低 35%，持续 0.9 秒，攻击速度降低 30%，持续 1.2 秒。审查冷却 3.7 秒。条款批注，就是减速带。",
        shortDesc: "普攻命中：目标移速 -35%（0.9s）、攻速 -30%（1.2s），冷却 3.7s。",
        type: "claude",
        cooldown: 3.7,
        slowFactor: 0.35,
        slowDuration: 0.9,
        attackSpeedReduction: 0.3,
        attackSpeedDuration: 1.2
      },
      normal: {
        name: "书页回旋",
        type: "projectile",
        flavor: "掷出一页附加条款的高速书页。",
        damage: 30,
        cooldown: 0.56,
        windup: 0.1,
        duration: 0.27,
        knockback: 230,
        projectile: { speed: 780, w: 54, h: 28 }
      },
      skill: {
        name: "封号审判",
        meme: "账号已封禁",
        flavor: "在目标脚下降下那柄传说中的封号法槌。",
        type: "ban",
        cost: 56,
        cooldown: 8,
        damage: 132,
        radius: 140,
        warning: 0.53,
        stun: 0.7,
        rootDuration: 1,
        windup: 0.3,
        duration: 0.57,
        knockback: 320,
        rapidNormalCharges: 3,
        rapidNormalSpeed: 0.4
      }
    },
    {
      id: "doubao",
      name: "豆包",
      title: "元气团子",
      role: "近战 · 高闪避",
      meme: "已读乱回",
      quote: "“已读，乱回。”",
      subline: "“但我很可爱。”",
      serial: "DB // 005",
      color: "#ffd25f",
      accentRgb: "255, 210, 95",
      image: "assets/chars/doubao.webp",
      formImage: "assets/chars/doubao-soy.webp",
      battleHeight: 178,
      formHeight: 198,
      // 移动帧：AI 生成的左右行走精灵图（横向条带，12 帧，每格 160×160）
      walk: {
        sheet: "assets/chars/doubao_walk_{dir}.webp",
        frames: 12,
        cell: 160,
        fps: 12,
        heightRatio: 0.92
      },
      counter: "deepseek",
      matchup: "高速贴脸，躲开白饭落点。",
      hpMax: 1240,
      tokenMax: 100,
      tokenRegen: 10.5,
      crit: 0.1,
      dodge: 0.15,
      speed: 354,
      jump: 850,
      aiRange: 132,
      passive: {
        name: "已读回蓝",
        desc: "成功闪避时获得 0.7 秒 25% 移速加成；技能冷却 -1.5 秒；并回复 7 TOKEN（回复效果冷却 1.5 秒）。已读，但不完全回。",
        shortDesc: "成功闪避：移速 +25%（0.7s），技能冷却 -1.5s，并回复 7 TOKEN（1.5s 内置冷却）。",
        type: "doubao",
        tokenGain: 7,
        tokenCooldown: 1.5,
        skillCdRefund: 1.5,
        dodgeSpeedBonus: 0.25,
        dodgeSpeedDuration: 0.7
      },
      normal: {
        name: "豆包冲撞",
        type: "melee",
        flavor: "用圆滚滚的身体发起不讲道理的短距离冲撞。",
        damage: 29,
        cooldown: 0.36,
        windup: 0.06,
        duration: 0.24,
        range: 133,
        knockback: 205
      },
      skill: {
        name: "豆奶变身",
        meme: "变身豆奶",
        flavor: "咕嘟咕嘟——变成奶白奶白的豆奶形态。",
        type: "milk",
        cost: 75,
        cooldown: 18,
        buffDuration: 8,
        damageBonus: 0.45,
        speedBonus: 0.35,
        attackSpeedBonus: 0.35,
        controlResist: 0.3,
        lifesteal: 0.35,
        windup: 0.22,
        duration: 0.62,
        knockback: 0
      }
    }
  ];

  const BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

  /* Build every rules string from the same numbers used by combat. */
  function hydrateCharacter(c) {
    const n = c.normal;
    const s = c.skill;
    const rangedRange = Math.round(RANGED_LIMIT * (1 + (c.attackRangeBonus || 0)));

    if (n.type === "melee") {
      n.desc = `${n.flavor} ${n.range}px 近战范围，命中造成 ${n.damage} 点伤害并轻击退；攻击间隔 ${n.cooldown.toFixed(2)} 秒。普通攻击可暴击。`;
      n.shortDesc = `${n.damage} 伤害 · ${n.range}px 近战 · ${n.cooldown.toFixed(2)}s 间隔 · 可暴击`;
    } else {
      n.desc = `${n.flavor} 命中造成 ${n.damage} 点伤害；最大命中距离为 ${rangedRange}px，攻击间隔 ${n.cooldown.toFixed(2)} 秒。普通攻击可暴击。`;
      n.shortDesc = `${n.damage} 伤害 · ${rangedRange}px 弹道 · ${n.cooldown.toFixed(2)}s 间隔 · 可暴击`;
    }

    switch (s.type) {
      case "rice":
        s.desc = `${s.flavor} ${s.warning.toFixed(2)} 秒预警后砸落，横向 ${s.bowlCount} 碗互不重叠，每碗对 ${s.radius}px 范围造成 ${s.damage} 点伤害；同一目标至多被一碗命中。未命中的白饭会留在原地 1 秒，DeepSeek 触碰后回复 30 点生命。施放需对手位于半场 ${RANGED_LIMIT}px 内。消耗 ${s.cost} TOKEN，冷却 ${s.cooldown} 秒。技能不暴击。`;
        s.shortDesc = `${s.damage} 伤害 × ${s.bowlCount} 碗 · 范围 ${s.radius}px · 未命中留饭回血 · ${s.cost} TOKEN / CD ${s.cooldown}s`;
        break;
      case "scroll":
        s.desc = `${s.flavor} 卷轴飞行速度提升 50%，命中造成 ${s.damage} 点伤害与更强击退。施放后强化下 3 次普攻：射程 +60%、击退 +25%；并获得 ${s.lifestealDuration} 秒 ${Math.round(s.lifesteal * 100)}% 吸血。施放需对手位于半场 ${RANGED_LIMIT}px 内。消耗 ${s.cost} TOKEN，冷却 ${s.cooldown} 秒。技能不暴击。`;
        s.shortDesc = `${s.damage} 伤害 · 高速强击退 · 下 3 次普攻射程/击退强化 · ${s.lifestealDuration}s 吸血 ${Math.round(s.lifesteal * 100)}% · ${s.cost} TOKEN / CD ${s.cooldown}s`;
        break;
      case "beam":
        s.desc = `${s.flavor} 施放距离 ${rangedRange}px。短暂蓄力后释放，造成 ${s.damage} 点伤害。光束会出现在<b>释放瞬间对手所在的那一行</b>（跟随目标高度），${s.warning.toFixed(2)} 秒预警后落下；离开原位或跳起可躲开。施放需对手位于 ${rangedRange}px 内。消耗 ${s.cost} TOKEN，冷却 ${s.cooldown} 秒。技能不暴击。`;
        s.shortDesc = `${s.damage} 伤害 · ${rangedRange}px 光束 · 锁定对手所在行 · ${s.warning.toFixed(2)}s 预警 · ${s.cost} TOKEN / CD ${s.cooldown}s`;
        break;
      case "ban":
        s.desc = `${s.flavor} 施放位置锁定为施放瞬间目标所在位置。施放与预警速度提升 50%。${s.warning.toFixed(2)} 秒预警后砸下，对 ${s.radius}px 范围内目标造成 ${s.damage} 点伤害。命中后对手先无法操作 ${s.stun.toFixed(1)} 秒，随后 ${s.rootDuration.toFixed(0)} 秒无法移动和冲刺，但仍可攻击。释放后下 3 次普攻攻速提升 40%。消耗 ${s.cost} TOKEN，冷却 ${s.cooldown} 秒。技能不暴击。`;
        s.shortDesc = `落点锁定施放瞬间目标位置 · ${s.damage} 伤害 · 眩晕 ${s.stun.toFixed(1)}s + 定身 ${s.rootDuration.toFixed(0)}s · 下 3 次普攻攻速 +40% · ${s.cost} TOKEN / CD ${s.cooldown}s`;
        break;
      case "milk":
        s.desc = `${s.flavor} 变身为豆奶形态 ${s.buffDuration} 秒：普通攻击伤害提高 ${Math.round(s.damageBonus * 100)}%，攻击速度提高 ${Math.round(s.attackSpeedBonus * 100)}%，移动速度提高 ${Math.round(s.speedBonus * 100)}%，并获得 ${Math.round(s.lifesteal * 100)}% 吸血；受到的控制时间降低 ${Math.round(s.controlResist * 100)}%，同时更换专属立绘。消耗 ${s.cost} TOKEN，冷却 ${s.cooldown} 秒。变身本身不造成伤害。`;
        s.shortDesc = `变身 ${s.buffDuration}s · 普攻伤害 +${Math.round(s.damageBonus * 100)}% / 攻速 +${Math.round(s.attackSpeedBonus * 100)}% / 移速 +${Math.round(s.speedBonus * 100)}% / 吸血 ${Math.round(s.lifesteal * 100)}% / 受控 -${Math.round(s.controlResist * 100)}% · ${s.cost} TOKEN / CD ${s.cooldown}s`;
        break;
      case "bubbles":
        s.desc = `${s.flavor} 每个气泡造成 ${s.damage} 点伤害，最多 ${s.damage * s.count} 点。消耗 ${s.cost} TOKEN，冷却 ${s.cooldown} 秒。技能不暴击。`;
        s.shortDesc = `${s.damage} 伤害 × ${s.count} 气泡 · ${s.cost} TOKEN / CD ${s.cooldown}s`;
        break;
      default:
        s.desc = "";
        s.shortDesc = "";
    }
  }
  CHARACTERS.forEach(hydrateCharacter);
  CHARACTERS.forEach((c) => {
    const counterSource = CHARACTERS.find((other) => other.counter === c.id);
    c.counteredBy = counterSource ? counterSource.id : null;
    c.counterName = BY_ID[c.counter] ? BY_ID[c.counter].name : "";
    c.counteredByName = c.counteredBy && BY_ID[c.counteredBy] ? BY_ID[c.counteredBy].name : "";
  });

  /* ═══════════════════════════════════════════════════════
     DOM refs
     ═══════════════════════════════════════════════════════ */
  const selectScreen = $("#selectScreen");
  const battleScreen = $("#battleScreen");
  const battleShell = $("#battleShell");
  const canvas = $("#gameCanvas");
  const ctx = canvas.getContext("2d");

  const ui = {
    profilePanel: $("#profilePanel"),
    heroNum: $("#heroNum"),
    heroName: $("#heroName"),
    heroRole: $("#heroRole"),
    heroTitle: $("#heroTitle"),
    heroMeme: $("#heroMeme"),
    heroQuote: $("#heroQuote"),
    counterName: $("#counterName"),
    counterDesc: $("#counterDesc"),
    counteredBy: $("#counteredBy"),
    matchupCard: $("#matchupCard"),
    passiveName: $("#passiveName"),
    passiveDesc: $("#passiveDesc"),
    artIndex: $("#artIndex"),
    artSerial: $("#artSerial"),
    artSubline: $("#artSubline"),
    heroImg: $("#heroImg"),
    rosterList: $("#rosterList"),
    startBtn: $("#startBtn"),
    modeSwitch: $("#modeSwitch"),
    aiLaunch: $("#aiLaunch"),
    onlineLaunch: $("#onlineLaunch"),
    aiOpponentText: $("#aiOpponentText"),
    difficultyRow: $("#difficultyRow"),
    onlineEntry: $("#onlineEntry"),
    onlineWait: $("#onlineWait"),
    onlineSelect: $("#onlineSelect"),
    onlineNote: $("#onlineNote"),
    onlineRoute: $("#onlineRoute"),
    createRoomBtn: $("#createRoomBtn"),
    joinRoomBtn: $("#joinRoomBtn"),
    roomCodeInput: $("#roomCodeInput"),
    roomCodeText: $("#roomCodeText"),
    onlineWaitText: $("#onlineWaitText"),
    copyRoomBtn: $("#copyRoomBtn"),
    cancelOnlineBtn: $("#cancelOnlineBtn"),
    onlineTimer: $("#onlineTimer"),
    onlineMyPick: $("#onlineMyPick"),
    onlineOpponentStatus: $("#onlineOpponentStatus"),
    onlineRoomMini: $("#onlineRoomMini"),
    onlineConfirmBtn: $("#onlineConfirmBtn"),
    onlineLeaveBtn: $("#onlineLeaveBtn"),
    modeButtons: $$(".mode-button"),
    difficultyButtons: $$(".difficulty-btn"),
    playerAvatarTag: $(".player-avatar .avatar-tag"),
    enemyAvatarTag: $(".enemy-avatar .avatar-tag"),
    statHp: $("#statHp"),
    statToken: $("#statToken"),
    statRegen: $("#statRegen"),
    statDamage: $("#statDamage"),
    statCrit: $("#statCrit"),
    statDodge: $("#statDodge"),
    statHpBar: $("#statHpBar"),
    statTokenBar: $("#statTokenBar"),
    statDamageBar: $("#statDamageBar"),
    statCritBar: $("#statCritBar"),
    statDodgeBar: $("#statDodgeBar"),
    normalName: $("#normalName"),
    normalMeta: $("#normalMeta"),
    normalDesc: $("#normalDesc"),
    descModeBtn: $("#descModeBtn"),
    skillName: $("#skillName"),
    skillMeta: $("#skillMeta"),
    skillDesc: $("#skillDesc"),
    skillCd: $("#skillCd"),
    skillTag: $("#skillTag"),
    selectSoundBtn: $("#selectSoundBtn"),
    battleSoundBtn: $("#battleSoundBtn"),
    pauseBtn: $("#pauseBtn"),
    playerAvatar: $("#playerAvatar"),
    enemyAvatar: $("#enemyAvatar"),
    playerHudName: $("#playerHudName"),
    enemyHudName: $("#enemyHudName"),
    playerHudTag: $("#playerHudTag"),
    enemyHudTag: $("#enemyHudTag"),
    playerHpFill: $("#playerHpFill"),
    enemyHpFill: $("#enemyHpFill"),
    playerTokenFill: $("#playerTokenFill"),
    enemyTokenFill: $("#enemyTokenFill"),
    playerHpText: $("#playerHpText"),
    enemyHpText: $("#enemyHpText"),
    playerTokenText: $("#playerTokenText"),
    enemyTokenText: $("#enemyTokenText"),
    timerText: $("#timerText"),
    netBadge: $("#netBadge"),
    latencyBadge: $("#latencyBadge"),
    latencyText: $("#latencyText"),
    rematchTimer: $("#rematchTimer"),
    announce: $("#announce"),
    hudToast: $("#hudToast"),
    normalAbility: $("#normalAbility"),
    skillAbility: $("#skillAbility"),
    abilityNormalName: $("#abilityNormalName"),
    abilitySkillName: $("#abilitySkillName"),
    abilitySkillCost: $("#abilitySkillCost"),
    normalState: $("#normalState"),
    skillState: $("#skillState"),
    normalProgress: $("#normalProgress"),
    skillProgress: $("#skillProgress"),
    guideSkill: $("#guideSkill"),
    guideSkillName: $("#guideSkillName"),
    guideSkillState: $("#guideSkillState"),
    guideSkillFill: $("#guideSkillFill"),
    skillCdOrb: $("#skillCdOrb"),
    passiveBanner: $("#passiveBanner"),
    pauseOverlay: $("#pauseOverlay"),
    resultOverlay: $("#resultOverlay"),
    resultCard: $("#resultCard"),
    resultKicker: $("#resultKicker"),
    resultTitle: $("#resultTitle"),
    resultSub: $("#resultSub"),
    resultImg: $("#resultImg"),
    resultBadge: $("#resultBadge"),
    resultStats: $("#resultStats"),
    resultFootnote: $("#resultFootnote"),
    resumeBtn: $("#resumeBtn"),
    quitBtn: $("#quitBtn"),
    rematchBtn: $("#rematchBtn"),
    changeBtn: $("#changeBtn"),
    settingsBtn: $("#settingsBtn"),
    fullscreenBtn: $("#fullscreenBtn"),
    settingsFullscreenBtn: $("#settingsFullscreenBtn"),
    noticeOverlay: $("#noticeOverlay"),
    noticeCloseBtn: $("#noticeCloseBtn"),
    noticeEnterBtn: $("#noticeEnterBtn"),
    noticeTitle: $("#noticeTitle"),
    noticeTabs: $$(".notice-tab"),
    noticePages: $$(".notice-page"),
    noticeTagline: $("#noticeOverlay .system-tagline"),
    noticeRailCopy: $("#noticeOverlay .notice-rail-copy"),
    settingsOverlay: $("#settingsOverlay"),
    settingsCloseBtn: $("#settingsCloseBtn"),
    settingsTabs: $$(".settings-tab"),
    settingsPanels: $$(".settings-panel"),
    volumeSlider: $("#volumeSlider"),
    volumeValue: $("#volumeValue"),
    volumeHint: $("#volumeHint"),
    settingsSoundToggle: $("#settingsSoundToggle"),
    volumeTestBtn: $("#volumeTestBtn"),
    openNoticeFromKeys: $("#openNoticeFromKeys"),
    openNoticeFromSettings: $("#openNoticeFromSettings"),
    copyChips: $$("[data-copy]")
  };

  let selectedId = "deepseek";
  let selectedDifficulty = "easy";
  let selectedMode = "ai";
  let compactDescriptions = true;
  let battle = null;
  let toastTimer = 0;
  let announceTimer = 0;
  let passiveBannerTimer = 0;
  let audioReady = false;
  const keys = new Set();
  const imageCache = {};
  let online = null;
  let publicInviteBase = "";
  let publicLineName = "";
  let publicLineMs = 0;

  /* ═══════════════════════════════════════════════════════
     Audio — tiny synthesized SFX, no external files
     ═══════════════════════════════════════════════════════ */
  const AudioEngine = {
    ctx: null,
    master: null,
    enabled: true,
    volume: 100,

    loadPreference() {
      try {
        const saved = localStorage.getItem("ai-arena-sfx");
        if (saved === "off") this.enabled = false;
        const rawVolume = localStorage.getItem("ai-arena-volume");
        if (rawVolume !== null) {
          const savedVolume = Number(rawVolume);
          if (Number.isFinite(savedVolume)) this.volume = clamp(savedVolume, 0, 100);
        }
      } catch (e) { /* file:// privacy mode */ }
      document.body.classList.toggle("sound-muted", !this.enabled);
    },

    gainValue() {
      // 200% of the previous master gain.
      return this.enabled ? 0.66 * (this.volume / 100) : 0;
    },

    applyGain() {
      if (!this.master) return;
      try {
        this.master.gain.setTargetAtTime(this.gainValue(), this.ctx.currentTime, 0.015);
      } catch (e) {
        this.master.gain.value = this.gainValue();
      }
    },

    setVolume(percent) {
      this.volume = clamp(Number(percent) || 0, 0, 100);
      try { localStorage.setItem("ai-arena-volume", String(Math.round(this.volume))); } catch (e) {}
      this.applyGain();
      syncAudioControls();
    },

    unlock() {
      if (!this.enabled) return;
      if (!this.ctx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        this.ctx = new AudioCtor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.gainValue();
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 20;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;
        this.master.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      audioReady = true;
    },

    toggle() {
      this.enabled = !this.enabled;
      document.body.classList.toggle("sound-muted", !this.enabled);
      try { localStorage.setItem("ai-arena-sfx", this.enabled ? "on" : "off"); } catch (e) {}
      if (this.enabled) {
        this.unlock();
        this.applyGain();
        this.play("ui");
      } else {
        this.applyGain();
      }
      syncAudioControls();
    },

    tone({ freq = 400, endFreq = null, duration = 0.1, type = "sine", volume = 0.18, delay = 0 }) {
      if (!this.enabled || !this.ctx || !this.master) return;
      const start = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), start);
      if (endFreq !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    },

    play(name) {
      if (!this.enabled) return;
      this.unlock();
      if (!this.ctx) return;
      switch (name) {
        case "click": {
          const variant = Math.random();
          if (variant < 0.34) {
            this.tone({ freq: 1180, endFreq: 880, duration: 0.032, type: "triangle", volume: 0.03 });
            this.tone({ freq: 220, endFreq: 160, duration: 0.04, type: "sine", volume: 0.02 });
          } else if (variant < 0.68) {
            this.tone({ freq: 940, endFreq: 1240, duration: 0.028, type: "sine", volume: 0.03 });
            this.tone({ freq: 300, endFreq: 220, duration: 0.035, type: "triangle", volume: 0.018 });
          } else {
            this.tone({ freq: 1560, endFreq: 1180, duration: 0.024, type: "triangle", volume: 0.024 });
          }
          break;
        }
        case "hover":
          this.tone({ freq: 760 + Math.random() * 140, endFreq: 900, duration: 0.025, type: "sine", volume: 0.014 });
          break;
        case "confirm":
          this.tone({ freq: 520, endFreq: 660, duration: 0.08, type: "triangle", volume: 0.045 });
          this.tone({ freq: 780, endFreq: 1040, duration: 0.1, type: "sine", volume: 0.03, delay: 0.06 });
          break;
        case "back":
          this.tone({ freq: 460, endFreq: 300, duration: 0.09, type: "sine", volume: 0.032 });
          break;
        case "toggle":
          this.tone({ freq: 1020, duration: 0.035, type: "square", volume: 0.022 });
          this.tone({ freq: 680, duration: 0.045, type: "sine", volume: 0.02, delay: 0.035 });
          break;
        case "ui":
          this.tone({ freq: 620, endFreq: 820, duration: 0.055, type: "sine", volume: 0.05 });
          break;
        case "key":
          this.tone({ freq: 520, endFreq: 640, duration: 0.03, type: "sine", volume: 0.026 });
          break;
        case "dash":
          this.tone({ freq: 260, endFreq: 760, duration: 0.095, type: "triangle", volume: 0.03 });
          this.tone({ freq: 940, endFreq: 620, duration: 0.06, type: "sine", volume: 0.018, delay: 0.02 });
          break;
        case "heal":
          this.tone({ freq: 660, endFreq: 980, duration: 0.13, type: "sine", volume: 0.026 });
          this.tone({ freq: 990, endFreq: 1320, duration: 0.16, type: "sine", volume: 0.018, delay: 0.06 });
          break;
        case "count":
          this.tone({ freq: 440, endFreq: 520, duration: 0.1, type: "triangle", volume: 0.1 });
          break;
        case "fight":
          this.tone({ freq: 180, endFreq: 620, duration: 0.26, type: "sawtooth", volume: 0.08 });
          this.tone({ freq: 660, duration: 0.2, type: "sine", volume: 0.08, delay: 0.03 });
          break;
        case "jump":
          this.tone({ freq: 240, endFreq: 480, duration: 0.11, type: "sine", volume: 0.045 });
          break;
        case "swing":
          this.tone({ freq: 220 + Math.random() * 40, endFreq: 85 + Math.random() * 25, duration: 0.085, type: "triangle", volume: 0.06 });
          break;
        case "shot":
          this.tone({ freq: 680 + Math.random() * 120, endFreq: 240 + Math.random() * 60, duration: 0.07, type: "sine", volume: 0.045 });
          break;
        case "hit":
          this.tone({ freq: 118 + Math.random() * 26, endFreq: 50 + Math.random() * 16, duration: 0.07, type: "square", volume: 0.072 });
          this.tone({ freq: 300 + Math.random() * 60, endFreq: 150 + Math.random() * 40, duration: 0.05, type: "triangle", volume: 0.044 });
          break;
        case "meleeHit":
          this.tone({ freq: 100 + Math.random() * 20, endFreq: 42 + Math.random() * 12, duration: 0.1, type: "square", volume: 0.08 });
          this.tone({ freq: 210 + Math.random() * 45, endFreq: 110 + Math.random() * 20, duration: 0.06, type: "triangle", volume: 0.052 });
          this.tone({ freq: 760 + Math.random() * 180, endFreq: 420 + Math.random() * 80, duration: 0.045, type: "sine", volume: 0.024 });
          break;
        case "skillHit":
          this.tone({ freq: 190, endFreq: 95, duration: 0.09, type: "triangle", volume: 0.045 });
          this.tone({ freq: 740, endFreq: 420, duration: 0.07, type: "sine", volume: 0.026, delay: 0.01 });
          break;
        case "transform":
          this.tone({ freq: 520, endFreq: 1040, duration: 0.26, type: "sine", volume: 0.045 });
          this.tone({ freq: 780, endFreq: 1560, duration: 0.28, type: "sine", volume: 0.03, delay: 0.06 });
          this.tone({ freq: 1180, endFreq: 1680, duration: 0.2, type: "triangle", volume: 0.024, delay: 0.13 });
          break;
        case "crit":
          this.tone({ freq: 118, endFreq: 55, duration: 0.11, type: "square", volume: 0.07 });
          this.tone({ freq: 980, endFreq: 540, duration: 0.13, type: "sine", volume: 0.055 });
          break;
        case "dodge":
          this.tone({ freq: 520, endFreq: 1100, duration: 0.085, type: "sine", volume: 0.035 });
          break;
        case "skill":
          this.tone({ freq: 110, endFreq: 460, duration: 0.32, type: "sawtooth", volume: 0.045 });
          this.tone({ freq: 880, endFreq: 440, duration: 0.22, type: "sine", volume: 0.035, delay: 0.05 });
          break;
        case "slam":
          this.tone({ freq: 82, endFreq: 34, duration: 0.35, type: "square", volume: 0.08 });
          this.tone({ freq: 190, endFreq: 70, duration: 0.2, type: "triangle", volume: 0.05 });
          break;
        case "beam":
          this.tone({ freq: 260, endFreq: 780, duration: 0.18, type: "sawtooth", volume: 0.055 });
          this.tone({ freq: 760, endFreq: 260, duration: 0.22, type: "sine", volume: 0.035, delay: 0.03 });
          break;
        case "rice":
          this.tone({ freq: 460, endFreq: 150, duration: 0.22, type: "triangle", volume: 0.06 });
          break;
        case "bubble":
          this.tone({ freq: 540, endFreq: 880, duration: 0.07, type: "sine", volume: 0.025 });
          break;
        case "ko":
          this.tone({ freq: 240, endFreq: 55, duration: 0.78, type: "sawtooth", volume: 0.075 });
          this.tone({ freq: 640, endFreq: 130, duration: 0.55, type: "triangle", volume: 0.04, delay: 0.08 });
          break;
        case "win":
          this.tone({ freq: 523, duration: 0.16, type: "sine", volume: 0.065 });
          this.tone({ freq: 659, duration: 0.16, type: "sine", volume: 0.06, delay: 0.14 });
          this.tone({ freq: 784, duration: 0.28, type: "sine", volume: 0.065, delay: 0.28 });
          break;
        case "lose":
          this.tone({ freq: 330, endFreq: 180, duration: 0.32, type: "triangle", volume: 0.055 });
          this.tone({ freq: 220, endFreq: 110, duration: 0.45, type: "sine", volume: 0.035, delay: 0.18 });
          break;
        default:
          break;
      }
    }
  };
  AudioEngine.loadPreference();

  // Light tactile feedback for every clickable control; attack/skill
  // sounds remain handled by combat actions.
  let lastHoverControl = null;
  let lastHoverAt = 0;
  document.addEventListener("pointerdown", (event) => {
    const control = event.target instanceof Element
      ? event.target.closest("button, [role='button'], .roster-card, input[type='range']")
      : null;
    if (!control || control.disabled) return;
    AudioEngine.unlock();
    AudioEngine.play("click");
  }, { passive: true });
  document.addEventListener("pointerover", (event) => {
    const control = event.target instanceof Element
      ? event.target.closest("button, [role='button'], .roster-card")
      : null;
    if (!control || control.disabled || control === lastHoverControl) return;
    const now = performance.now();
    if (now - lastHoverAt < 90) return;
    lastHoverControl = control;
    lastHoverAt = now;
    AudioEngine.unlock();
    AudioEngine.play("hover");
  }, { passive: true });

  /* ═══════════════════════════════════════════════════════
     Online transport
     ═══════════════════════════════════════════════════════ */
  const Network = {
    ws: null,
    connected: false,
    connecting: null,
    suppressClose: false,

    url() {
      if (location.protocol === "http:" || location.protocol === "https:") {
        return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
      }
      return "ws://127.0.0.1:3000/ws";
    },

    connect() {
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        return Promise.resolve();
      }
      if (this.connecting) return this.connecting;
      this.connecting = new Promise((resolve, reject) => {
        let settled = false;
        let ws;
        try {
          ws = new WebSocket(this.url());
        } catch (err) {
          this.connecting = null;
          reject(err);
          return;
        }
        this.ws = ws;
        const timeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          this.connecting = null;
          try { ws.close(); } catch (err) {}
          reject(new Error("连接超时"));
        }, 4500);
        ws.addEventListener("open", () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          this.connected = true;
          this.connecting = null;
          this.suppressClose = false;
          resolve();
        }, { once: true });
        ws.addEventListener("message", (event) => {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch (err) {
            return;
          }
          handleServerMessage(message);
        });
        ws.addEventListener("error", () => {
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            this.connecting = null;
            reject(new Error("无法连接联机服务器"));
          }
        });
        ws.addEventListener("close", () => {
          this.connected = false;
          this.ws = null;
          this.connecting = null;
          if (!this.suppressClose) handleNetworkClose();
        });
      });
      return this.connecting;
    },

    send(message) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (err) {
        return false;
      }
    },

    sendGame(message) {
      const data = JSON.stringify(message);
      if (RTCSession.isActive()) {
        const channel = RTCSession.channel;
        try {
          if (message.type === "state" && channel.bufferedAmount > 256 * 1024) return false;
          channel.send(data);
          return true;
        } catch (err) {
          // Fall through to the relay path.
        }
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      try {
        if (message.type === "state" && this.ws.bufferedAmount > 256 * 1024) return false;
        this.ws.send(data);
        return true;
      } catch (err) {
        return false;
      }
    },

    close(notify = true) {
      RTCSession.close();
      this.suppressClose = true;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (notify) this.send({ type: "leave" });
        try { this.ws.close(); } catch (err) {}
      }
      this.connected = false;
      this.ws = null;
      this.connecting = null;
    }
  };

  /* ═══════════════════════════════════════════════════════
     WebRTC P2P data channel — low-latency game traffic
     WebSocket remains for lobby, rematch and signaling.
     ═══════════════════════════════════════════════════════ */
  const RTCSession = {
    pc: null,
    channel: null,
    role: null,
    active: false,
    readySent: false,
    remoteSet: false,
    pendingCandidates: [],
    fallbackTimer: 0,
    notifiedActive: false,
    failedNotified: false,

    supported() {
      return typeof window.RTCPeerConnection === "function";
    },

    isActive() {
      return !!(this.active && this.channel && this.channel.readyState === "open");
    },

    setBadge(mode) {
      if (!ui.netBadge) return;
      const onlineBattle = !!(battle && battle.online);
      if (!onlineBattle) {
        ui.netBadge.hidden = true;
        return;
      }
      ui.netBadge.hidden = false;
      ui.netBadge.classList.remove("is-p2p", "is-relay", "is-connecting");
      if (mode === "p2p") {
        ui.netBadge.textContent = "P2P 直连";
        ui.netBadge.classList.add("is-p2p");
      } else if (mode === "relay") {
        ui.netBadge.textContent = "服务器中继";
        ui.netBadge.classList.add("is-relay");
      } else {
        ui.netBadge.textContent = "正在建立直连…";
        ui.netBadge.classList.add("is-connecting");
      }
    },

    clearFallback() {
      if (this.fallbackTimer) {
        window.clearTimeout(this.fallbackTimer);
        this.fallbackTimer = 0;
      }
    },

    startFallbackTimer() {
      this.clearFallback();
      this.fallbackTimer = window.setTimeout(() => {
        if (!this.isActive()) {
          this.setBadge("relay");
          if (!this.failedNotified) {
            this.failedNotified = true;
            showToast("P2P 直连未建立，已切换服务器中继", 1900);
          }
        }
      }, 12000);
    },

    resetPeer() {
      this.clearFallback();
      if (this.channel) {
        try {
          this.channel.onopen = null;
          this.channel.onmessage = null;
          this.channel.onclose = null;
          this.channel.onerror = null;
          this.channel.close();
        } catch (e) { /* ignore */ }
      }
      if (this.pc) {
        try { this.pc.close(); } catch (e) { /* ignore */ }
      }
      this.pc = null;
      this.channel = null;
      this.role = null;
      this.active = false;
      this.readySent = false;
      this.remoteSet = false;
      this.pendingCandidates = [];
    },

    close() {
      this.resetPeer();
      if (ui.netBadge) ui.netBadge.hidden = true;
    },

    createPeer(role) {
      this.resetPeer();
      this.role = role;
      this.notifiedActive = false;
      this.failedNotified = false;
      /* 同一局域网下，主机候选（host candidate）就能直连，根本不需要 STUN。
         STUN 服务器是公网服务，会带来一次额外的公网往返，是"手机连进对局很慢"的主因。
         所以这里按连接目标分情况：
         - 页面是局域网地址（或 localhost）→ 完全不查询 STUN，直接本机网络直连；
         - 公网地址 → 才使用 STUN 打洞。 */
      const isLocalNetwork = (() => {
        const host = location.hostname;
        if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
        return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
      })();
      const iceServers = isLocalNetwork
        ? []
        : [
          { urls: "stun:stun.cloudflare.com:3478" },
          { urls: "stun:stun.l.google.com:19302" }
        ];
      const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: isLocalNetwork ? 0 : 2
      });
      this.pc = pc;
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        Network.send({ type: "rtc-ice", candidate: event.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        if (this.pc !== pc) return;
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          this.handleFailure();
        }
      };
      this.startFallbackTimer();
      return pc;
    },

    setupChannel(channel) {
      this.channel = channel;
      channel.onopen = () => {
        if (this.channel !== channel) return;
        this.readySent = true;
        Network.send({ type: "rtc-ready" });
        this.setBadge("connecting");
      };
      channel.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch (e) { return; }
        if (message.type === "latency-ping") {
          try { channel.send(JSON.stringify({ type: "latency-pong", t: message.t })); } catch (e) { /* ignore */ }
          return;
        }
        if (message.type === "latency-pong") {
          Latency.receive(message.t, "p2p");
          return;
        }
        if (this.role === "host" && message.type === "input") {
          applyRemoteInput(message);
        } else if (this.role === "guest" && message.type === "state" && message.state) {
          applyOnlineSnapshot(message.state);
        }
      };
      channel.onclose = () => {
        if (this.active || this.readySent) {
          this.active = false;
          Network.send({ type: "rtc-down" });
          this.setBadge("relay");
          if (!this.failedNotified) {
            this.failedNotified = true;
            showToast("P2P 直连已断开，已切换服务器中继", 1900);
          }
        }
      };
      channel.onerror = () => {
        if (this.active) this.handleFailure();
      };
    },

    startHost() {
      if (!this.supported()) {
        this.setBadge("relay");
        return;
      }
      if (this.isActive()) {
        this.setBadge("p2p");
        return;
      }
      if (this.pc && (this.pc.connectionState === "new" || this.pc.connectionState === "connecting")) {
        this.setBadge("connecting");
        return;
      }
      const pc = this.createPeer("host");
      const channel = pc.createDataChannel("game", { ordered: true });
      this.setupChannel(channel);
      this.setBadge("connecting");
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          if (this.pc === pc && pc.localDescription) {
            Network.send({ type: "rtc-offer", sdp: pc.localDescription.sdp });
          }
        })
        .catch(() => this.handleFailure());
    },

    startGuest() {
      if (!this.supported()) {
        this.setBadge("relay");
        return;
      }
      if (this.isActive()) {
        this.setBadge("p2p");
        return;
      }
      this.setBadge("connecting");
    },

    handleOffer(sdp) {
      if (!this.supported() || !online || online.role !== "guest") return;
      const earlyCandidates = this.pendingCandidates.slice();
      this.resetPeer();
      this.notifiedActive = false;
      this.failedNotified = false;
      this.role = "guest";
      const pc = this.createPeer("guest");
      this.pendingCandidates = earlyCandidates;
      pc.ondatachannel = (event) => this.setupChannel(event.channel);
      pc.setRemoteDescription({ type: "offer", sdp })
        .then(() => {
          this.remoteSet = true;
          this.flushCandidates();
          return pc.createAnswer();
        })
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => {
          if (this.pc === pc && pc.localDescription) {
            Network.send({ type: "rtc-answer", sdp: pc.localDescription.sdp });
          }
        })
        .catch(() => this.handleFailure());
    },

    handleAnswer(sdp) {
      if (!this.pc || this.role !== "host" || this.remoteSet) return;
      this.pc.setRemoteDescription({ type: "answer", sdp })
        .then(() => {
          this.remoteSet = true;
          this.flushCandidates();
        })
        .catch(() => this.handleFailure());
    },

    addIce(candidate) {
      if (!candidate) return;
      if (!this.pc || !this.remoteSet) {
        this.pendingCandidates.push(candidate);
        return;
      }
      this.pc.addIceCandidate(candidate).catch(() => {});
    },

    flushCandidates() {
      if (!this.pc) return;
      const queued = this.pendingCandidates;
      this.pendingCandidates = [];
      for (const candidate of queued) {
        this.pc.addIceCandidate(candidate).catch(() => {});
      }
    },

    activate() {
      if (!this.channel || this.channel.readyState !== "open") {
        Network.send({ type: "rtc-down" });
        this.setBadge("relay");
        return;
      }
      this.active = true;
      this.clearFallback();
      this.setBadge("p2p");
      if (!this.notifiedActive) {
        this.notifiedActive = true;
        showToast("P2P 直连已建立 · 延迟更低", 1900);
      }
    },

    deactivate() {
      this.active = false;
      this.setBadge("relay");
      this.resetPeer();
    },

    handleFailure() {
      const shouldReport = this.readySent;
      this.active = false;
      if (shouldReport) Network.send({ type: "rtc-down" });
      this.setBadge("relay");
      if (!this.failedNotified) {
        this.failedNotified = true;
        showToast("P2P 直连不可用，已切换服务器中继", 1900);
      }
      this.resetPeer();
    }
  };

  let onlineUiTimer = null;
  let onlineAutoLockSent = false;
  let resultChoiceInterval = null;
  let resultChoiceDeadline = 0;
  let resultChoiceMode = "ai";
  let resultChoiceExpired = false;
  let resultChoiceFallbackTimer = 0;

  function clearResultChoiceTimer() {
    if (resultChoiceInterval) {
      window.clearInterval(resultChoiceInterval);
      resultChoiceInterval = null;
    }
    if (resultChoiceFallbackTimer) {
      window.clearTimeout(resultChoiceFallbackTimer);
      resultChoiceFallbackTimer = 0;
    }
  }

  function resultChoiceStatus(seconds) {
    if (resultChoiceMode === "online" && online) {
      const hostWants = !!(online.rematch && online.rematch.host);
      const guestWants = !!(online.rematch && online.rematch.guest);
      const mine = online.role === "host" ? hostWants : guestWants;
      const theirs = online.role === "host" ? guestWants : hostWants;
      if (online.phase === "ended") return "对战已结束";
      if (hostWants && guestWants) return "双方已同意再战，正在进入选人…";
      if (mine && theirs) return "双方已同意再战，正在进入选人…";
      if (mine) return `已选择再战，等待对手… ${seconds}s`;
      if (theirs) return `对手想再战 · ${seconds}s 内可以加入`;
      return `${seconds} 秒内可选择再战或结束 · 再战将重新选人`;
    }
    return seconds > 0 ? `${seconds} 秒内可选择再战或结束` : "时间到，本局结束";
  }

  function updateResultChoiceTimer() {
    if (!ui.rematchTimer) return;
    const seconds = Math.max(0, Math.ceil((resultChoiceDeadline - Date.now()) / 1000));
    ui.rematchTimer.textContent = resultChoiceStatus(seconds);
    if (resultChoiceMode === "online" && online) {
      const mine = online.role === "host" ? !!online.rematch?.host : !!online.rematch?.guest;
      if (mine || resultChoiceExpired) ui.rematchBtn.disabled = true;
    }
    if (seconds > 0 || resultChoiceExpired) return;
    resultChoiceExpired = true;
    ui.rematchBtn.disabled = true;
    ui.rematchTimer.textContent = resultChoiceMode === "online"
      ? "再战选择时间到，正在结束…"
      : "时间到，本局结束";
    if (resultChoiceMode === "ai") {
      clearResultChoiceTimer();
      window.setTimeout(() => {
        if (battle && battle.phase === "over" && !battle.online) returnToSelect();
      }, 380);
    } else {
      // The server owns the 15s window; this is only a safety net.
      resultChoiceFallbackTimer = window.setTimeout(() => {
        if (online && online.phase === "result") {
          showToast("再战等待超时，已结束", 1800);
          returnToSelect();
        }
      }, 2200);
    }
  }

  function startResultChoice(deadline, mode) {
    clearResultChoiceTimer();
    resultChoiceMode = mode;
    resultChoiceDeadline = Number(deadline) || (Date.now() + 15000);
    resultChoiceExpired = false;
    if (!ui.rematchTimer) return;
    ui.rematchTimer.hidden = false;
    ui.rematchBtn.style.display = "";
    ui.rematchBtn.disabled = false;
    ui.rematchBtn.textContent = "再战一局";
    ui.changeBtn.disabled = false;
    ui.changeBtn.textContent = "结束";
    updateResultChoiceTimer();
    resultChoiceInterval = window.setInterval(updateResultChoiceTimer, 200);
  }

  function setResultChoiceDeadline(deadline) {
    if (!deadline || !Number.isFinite(Number(deadline))) return;
    resultChoiceDeadline = Number(deadline);
    updateResultChoiceTimer();
  }

  function handleRematchClick() {
    if (!battle || battle.phase !== "over" || resultChoiceExpired) return;
    if (battle.online) {
      if (!online || online.phase !== "result") return;
      const mine = online.role === "host" ? !!online.rematch?.host : !!online.rematch?.guest;
      if (mine) return;
      online.rematch = online.rematch || { host: false, guest: false };
      online.rematch[online.role] = true;
      Network.send({ type: "rematch" });
      ui.rematchBtn.disabled = true;
      ui.rematchBtn.textContent = "等待对手…";
      updateResultChoiceTimer();
      AudioEngine.play("ui");
      return;
    }
    clearResultChoiceTimer();
    setOverlay(ui.resultOverlay, false);
    startBattle(selectedId, null, { difficulty: selectedDifficulty });
  }

  function handleEndResult() {
    if (battle && battle.online && online && online.phase === "result") {
      Network.send({ type: "matchEnd" });
    }
    clearResultChoiceTimer();
    returnToSelect();
  }

  function finishBattle() {
    if (!battle) return;
    const b = battle;
    b.phase = "over";
    clearResultChoiceTimer();
    const local = b.localFighter || b.player;
    const opponent = local === b.player ? b.enemy : b.player;
    const localIsPlayer = local === b.player;
    const localWon = !b.winner || b.winner === "draw"
      ? false
      : (b.winner === (localIsPlayer ? "player" : "enemy"));
    const draw = b.winner === "draw";
    const localStats = localIsPlayer ? b.stats.player : b.stats.enemy;

    ui.resultCard.classList.remove("is-win", "is-lose", "is-draw");
    ui.resultCard.classList.add(draw ? "is-draw" : localWon ? "is-win" : "is-lose");
    ui.resultKicker.textContent = draw ? "MATCH DRAW" : localWon ? "MATCH COMPLETE // WIN" : "MATCH COMPLETE // LOSE";
    ui.resultTitle.textContent = draw ? "DRAW" : localWon ? "VICTORY" : "DEFEAT";
    if (b.reason === "disconnect") {
      ui.resultSub.textContent = "对手已离开房间，本局对战结束。";
    } else if (b.reason === "time") {
      ui.resultSub.textContent = draw
        ? "时间到，双方剩余生命比例相同。"
        : localWon
          ? "时间到，你以更高的剩余生命比例取胜。"
          : "时间到，对手以更高的剩余生命比例取胜。";
    } else {
      ui.resultSub.textContent = localWon
        ? `你击破了 ${opponent.char.name}，算力对决由你收尾。`
        : `你被 ${opponent.char.name} 击破。调整节奏，再来一场。`;
    }
    ui.resultImg.src = local.milkTimer > 0 && local.char.formImage ? local.char.formImage : local.char.image;
    ui.resultImg.alt = `${local.char.name} 的战后立绘`;
    ui.resultBadge.textContent = local.milkTimer > 0 && local.char.formImage ? "MILK" : "YOU";
    const hpRatio = local.hp / local.char.hpMax;
    ui.resultStats.innerHTML = [
      ["造成伤害", Math.round(localStats.damage), ""],
      ["命中暴击", localStats.crits, "次"],
      ["成功闪避", localStats.dodges, "次"],
      ["剩余生命", Math.max(0, Math.ceil(hpRatio * 100)), "%"]
    ].map(([label, value, unit]) => `
      <div class="result-stat"><span>${label}</span><strong>${value}${unit ? `<em>${unit}</em>` : ""}</strong></div>
    `).join("");

    let deadline = Date.now() + 15000;
    if (b.online) {
      b.online.statePaused = true;
      if (online) {
        online.phase = "result";
        online.rematch = { host: false, guest: false };
        if (!online.rematchDeadline) online.rematchDeadline = deadline;
        deadline = online.rematchDeadline;
      }
      ui.resultFootnote.textContent = `用时 ${Math.round(b.elapsed)} 秒 · 联机对战已结束`;
      if (b.online.role === "host") {
        // Deliver one final authoritative state over the ordered lobby socket,
        // even though periodic snapshots are paused during the result window.
        const finalState = serializeOnlineBattle(b);
        finalState.final = true;
        Network.send({ type: "state", state: finalState });
      }
      if (b.online.role === "host" && !b.online.matchOverSent) {
        b.online.matchOverSent = true;
        Network.send({ type: "matchOver" });
      }
      startResultChoice(deadline, "online");
    } else {
      ui.resultFootnote.textContent = `用时 ${Math.round(b.elapsed)} 秒 · 15 秒内可再战或结束`;
      startResultChoice(deadline, "ai");
    }
    setOverlay(ui.resultOverlay, true);
    AudioEngine.play(localWon ? "win" : draw ? "ui" : "lose");
  }

  function setOnlineNote(text, isError = false) {
    if (!ui.onlineNote) return;
    ui.onlineNote.textContent = text;
    ui.onlineNote.style.color = isError ? "#ffb0bd" : "";
  }

  function setOnlineBusy(busy) {
    ui.createRoomBtn.disabled = busy;
    ui.joinRoomBtn.disabled = busy;
    ui.roomCodeInput.disabled = busy;
  }

  function setMode(mode, options = {}) {
    if (!options.force && online) return;
    selectedMode = mode === "online" ? "online" : "ai";
    for (const button of ui.modeButtons) {
      const active = button.dataset.mode === selectedMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    ui.aiLaunch.hidden = selectedMode !== "ai";
    ui.onlineLaunch.hidden = selectedMode !== "online";
    if (selectedMode === "online" && !online) showOnlineEntry();
  }

  function setDifficulty(level) {
    if (!AI_DIFFICULTIES[level]) return;
    selectedDifficulty = level;
    for (const button of ui.difficultyButtons) {
      button.classList.toggle("is-active", button.dataset.difficulty === level);
    }
    ui.aiOpponentText.textContent = `随机 AI · ${AI_DIFFICULTIES[level].label}模式`;
  }

  function showOnlineEntry() {
    ui.onlineEntry.hidden = false;
    ui.onlineWait.hidden = true;
    ui.onlineSelect.hidden = true;
    ui.modeSwitch.hidden = false;
    setOnlineNote("本机 / 局域网使用「启动游戏.bat」；跨网络使用「启动公网联机.bat」。创建房间后分享邀请链接即可。");
    setOnlineBusy(false);
    setRosterOnlineLock(false);
  }

  function showOnlineWaiting(roomId) {
    ui.onlineEntry.hidden = true;
    ui.onlineWait.hidden = false;
    ui.onlineSelect.hidden = true;
    ui.modeSwitch.hidden = true;
    ui.roomCodeText.textContent = roomId;
    ui.onlineWaitText.textContent = "等待另一位玩家加入房间…";
    setOnlineBusy(true);
    setRosterOnlineLock(false);
  }

  function setRosterOnlineLock(locked) {
    ui.rosterList.classList.toggle("online-locked", !!locked);
    for (const card of $$(".roster-card", ui.rosterList)) {
      card.setAttribute("aria-disabled", locked ? "true" : "false");
    }
  }

  function stopOnlineUiTimer() {
    if (onlineUiTimer) {
      window.clearInterval(onlineUiTimer);
      onlineUiTimer = null;
    }
  }

  function updateOnlineCountdown() {
    if (!online || online.phase !== "selecting") return;
    const remaining = Math.max(0, Math.ceil((online.deadline - Date.now()) / 1000));
    setText(ui.onlineTimer, String(remaining));
    if (remaining <= 0 && !online.locked && !onlineAutoLockSent) {
      onlineAutoLockSent = true;
      ui.onlineOpponentStatus.textContent = online.opponentLocked
        ? "倒计时结束 · 正在进入对战…"
        : "倒计时结束 · 自动确认当前角色";
      confirmOnlineSelection(true);
    }
  }

  function startOnlineSelection(message) {
    if (!online) return;
    Latency.stop();
    if (battle || battleScreen.classList.contains("is-active")) {
      clearResultChoiceTimer();
      if (ui.rematchTimer) ui.rematchTimer.hidden = true;
      if (ui.netBadge) ui.netBadge.hidden = true;
      showSelect();
    }
    online.phase = "selecting";
    online.role = message.side || online.role;
    online.roomId = message.roomId || online.roomId;
    online.deadline = Number(message.deadline) || (Date.now() + 30000);
    online.locked = false;
    online.opponentLocked = false;
    online.rematchDeadline = 0;
    online.rematch = { host: false, guest: false };
    onlineAutoLockSent = false;

    setMode("online", { force: true });
    ui.aiLaunch.hidden = true;
    ui.onlineLaunch.hidden = false;
    ui.modeSwitch.hidden = true;
    ui.onlineEntry.hidden = true;
    ui.onlineWait.hidden = true;
    ui.onlineSelect.hidden = false;
    ui.onlineRoomMini.textContent = online.roomId || "-----";
    ui.onlineMyPick.textContent = BY_ID[selectedId] ? BY_ID[selectedId].name : selectedId;
    ui.onlineOpponentStatus.textContent = "对手尚未确认";
    ui.onlineConfirmBtn.disabled = false;
    ui.onlineConfirmBtn.textContent = "确认出战 ";
    const tick = document.createElement("span");
    tick.textContent = "✓";
    ui.onlineConfirmBtn.appendChild(tick);
    setRosterOnlineLock(false);
    stopOnlineUiTimer();
    updateOnlineCountdown();
    onlineUiTimer = window.setInterval(updateOnlineCountdown, 180);
    Network.send({ type: "select", charId: selectedId });
  }

  function confirmOnlineSelection(auto = false) {
    if (!online || online.phase !== "selecting" || online.locked) return;
    if (!auto) enterFullscreen();
    online.locked = true;
    Network.send({ type: "lock", charId: selectedId });
    setRosterOnlineLock(true);
    ui.onlineConfirmBtn.disabled = true;
    ui.onlineConfirmBtn.textContent = auto ? "时间到 · 已自动确认" : "已确认 · 等待对手";
    ui.onlineOpponentStatus.textContent = online.opponentLocked
      ? "双方已确认，正在进入对战…"
      : "你已确认，等待对手确认…";
    AudioEngine.play("ui");
  }

  function lockStatusText() {
    if (!online) return "";
    if (online.locked && online.opponentLocked) return "双方已确认，正在进入对战…";
    if (online.locked) return "你已确认，等待对手确认…";
    if (online.opponentLocked) return "对手已确认 · 还在选人";
    return "对手尚未确认";
  }

  function updateOnlineLockUi() {
    if (!online || online.phase !== "selecting") return;
    ui.onlineOpponentStatus.textContent = lockStatusText();
    if (online.locked) {
      setRosterOnlineLock(true);
      ui.onlineConfirmBtn.disabled = true;
      ui.onlineConfirmBtn.textContent = "已确认 · 等待对手";
    }
  }

  function resetOnlineUi(mode = "ai") {
    stopOnlineUiTimer();
    if (online) online.phase = "idle";
    onlineAutoLockSent = false;
    ui.modeSwitch.hidden = false;
    ui.onlineEntry.hidden = false;
    ui.onlineWait.hidden = true;
    ui.onlineSelect.hidden = true;
    setRosterOnlineLock(false);
    setOnlineBusy(false);
    ui.onlineConfirmBtn.disabled = false;
    setMode(mode, { force: true });
  }

  function leaveOnlineRoom(mode = "ai", notify = true) {
    stopOnlineUiTimer();
    if (online) {
      online.phase = "idle";
      online = null;
    }
    Network.close(notify);
    resetOnlineUi(mode);
  }

  async function connectAndCreateRoom() {
    if (online) return;
    setOnlineBusy(true);
    setOnlineNote("正在连接联机服务器…");
    try {
      await Network.connect();
      setOnlineNote("连接成功，正在创建房间…");
      Network.send({ type: "create" });
    } catch (err) {
      setOnlineBusy(false);
      setOnlineNote(
        location.protocol === "file:"
          ? "无法连接联机服务器。请关闭本页，双击「启动游戏.bat」（本机/局域网）或「启动公网联机.bat」（跨网络），再打开游戏。"
          : "无法连接联机服务器。请关闭本页，重新双击「启动游戏.bat」或「启动公网联机.bat」，并确认 3000 端口未被占用。",
        true
      );
    }
  }

  function extractRoomCode(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^[A-Z0-9]{4,8}$/i.test(text)) return text.toUpperCase();
    try {
      const url = new URL(text, location.href);
      const room = url.searchParams.get("room");
      if (room) {
        const cleaned = room.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
        if (/^[A-Z0-9]{4,8}$/.test(cleaned)) return cleaned;
      }
    } catch (e) { /* not a URL */ }
    const inline = text.match(/(?:room=)([A-Z0-9]{4,8})/i);
    if (inline) return inline[1].toUpperCase();
    const token = text.toUpperCase().match(/\b([A-Z0-9]{4,8})\b/);
    return token ? token[1] : "";
  }

  async function connectAndJoinRoom() {
    if (online) return;
    const roomId = extractRoomCode(ui.roomCodeInput.value);
    if (!roomId) {
      setOnlineNote("请输入有效的房间码或邀请链接。", true);
      return;
    }
    ui.roomCodeInput.value = roomId;
    setOnlineBusy(true);
    setOnlineNote("正在连接联机服务器…");
    try {
      await Network.connect();
      setOnlineNote("连接成功，正在加入房间…");
      Network.send({ type: "join", roomId });
    } catch (err) {
      setOnlineBusy(false);
      setOnlineNote(
        location.protocol === "file:"
          ? "无法连接联机服务器。请关闭本页，双击「启动游戏.bat」（本机/局域网）或「启动公网联机.bat」（跨网络），再打开游戏。"
          : "无法连接联机服务器。请关闭本页，重新双击「启动游戏.bat」或「启动公网联机.bat」，并确认 3000 端口未被占用。",
        true
      );
    }
  }

  function handleNetworkClose() {
    if (!online) return;
    const wasBattle = !!battle && !!battle.online;
    stopOnlineUiTimer();
    clearResultChoiceTimer();
    RTCSession.close();
    online = null;
    if (wasBattle) {
      showToast("联机连接已断开", 2000);
      showSelect();
      resetOnlineUi("online");
      setOnlineNote("与服务器的连接已断开，请重新创建或加入房间。", true);
      return;
    }
    resetOnlineUi("online");
    setOnlineNote("与服务器的连接已断开。", true);
  }

  function handleOpponentLeft() {
    if (!online) return;
    stopOnlineUiTimer();
    if (online.phase === "result" || online.phase === "ended") {
      clearResultChoiceTimer();
      if (ui.rematchTimer) ui.rematchTimer.hidden = true;
      setOverlay(ui.resultOverlay, false);
      showToast("对手已离开房间", 1800);
      returnToSelect();
      return;
    }
    online.phase = "idle";
    if (battle && battle.online) {
      const local = battle.localFighter || battle.player;
      battle.winner = local === battle.player ? "player" : "enemy";
      battle.reason = "disconnect";
      if (battle.online.role === "guest") {
        finishBattle();
      } else {
        battle.phase = "ending";
        battle.endingTimer = 0.8;
      }
      showToast("对手已离开房间", 1800);
      return;
    }
    online = null;
    Network.close(false);
    resetOnlineUi("online");
    setOnlineNote("对手已离开房间。", true);
  }

  const Latency = {
    active: false,
    timer: null,
    pending: null,

    start() {
      this.stop();
      this.active = true;
      this.render(null, "connecting");
      this.sendPing();
      this.timer = window.setInterval(() => this.sendPing(), 1000);
    },

    stop() {
      this.active = false;
      if (this.timer) window.clearInterval(this.timer);
      this.timer = null;
      if (this.pending && this.pending.timeout) window.clearTimeout(this.pending.timeout);
      this.pending = null;
      if (ui.latencyBadge) ui.latencyBadge.hidden = true;
    },

    sendPing() {
      if (!this.active) return;
      if (this.pending) return;
      const p2p = RTCSession.isActive()
        && RTCSession.channel
        && RTCSession.channel.readyState === "open";
      if (!p2p && !Network.connected) return;
      const t = performance.now();
      const mode = p2p ? "p2p" : "relay";
      const timeout = window.setTimeout(() => {
        if (!this.pending || this.pending.t !== t) return;
        this.pending = null;
        this.render(null, mode);
      }, 2500);
      this.pending = { t, mode, timeout };
      if (p2p) {
        try {
          RTCSession.channel.send(JSON.stringify({ type: "latency-ping", t }));
        } catch (e) {
          window.clearTimeout(timeout);
          this.pending = null;
        }
      } else {
        Network.send({ type: "latency-ping", t });
      }
    },

    receive(t, mode) {
      if (!this.pending || this.pending.t !== t) return;
      if (this.pending.timeout) window.clearTimeout(this.pending.timeout);
      const ms = Math.max(0, performance.now() - t);
      const measuredMode = this.pending.mode || mode;
      this.pending = null;
      this.render(ms, measuredMode);
    },

    render(ms, mode) {
      if (!ui.latencyBadge || !ui.latencyText) return;
      ui.latencyBadge.hidden = false;
      ui.latencyBadge.classList.remove("is-good", "is-mid", "is-bad", "is-connecting");
      if (ms == null) {
        ui.latencyText.textContent = mode === "connecting" ? "检测线路…" : "延迟检测中";
        ui.latencyBadge.classList.add("is-connecting");
        return;
      }
      const modeLabel = mode === "p2p" ? "P2P" : "中继";
      ui.latencyText.textContent = `${modeLabel} · ${Math.round(ms)}ms`;
      ui.latencyBadge.classList.add(ms < 50 ? "is-good" : ms < 120 ? "is-mid" : "is-bad");
    }
  };

  function handleServerMessage(message) {
    if (!message || !message.type) return;
    switch (message.type) {
      case "roomCreated":
        online = {
          active: true,
          role: message.side || "host",
          roomId: message.roomId,
          phase: "waiting",
          locked: false,
          opponentLocked: false,
          deadline: 0
        };
        showOnlineWaiting(message.roomId);
        break;
      case "roomJoined":
        online = online || {};
        online.active = true;
        online.role = message.side || "guest";
        online.roomId = message.roomId;
        online.phase = "waiting";
        ui.onlineWaitText.textContent = "已加入房间，等待房主开始…";
        break;
      case "selectionStart":
        if (!online) {
          online = { active: true, locked: false, opponentLocked: false };
        }
        startOnlineSelection(message);
        break;
      case "lockStatus":
        if (!online) break;
        online.opponentLocked = online.role === "host" ? !!message.guestLocked : !!message.hostLocked;
        online.locked = online.role === "host" ? !!message.hostLocked : !!message.guestLocked;
        updateOnlineLockUi();
        break;
      case "matchStart":
        handleOnlineMatchStart(message);
        break;
      case "input":
        if (battle && battle.online && battle.online.role === "host" && !RTCSession.isActive()) {
          applyRemoteInput(message);
        }
        break;
      case "state":
        if (battle && battle.online && battle.online.role === "guest" && message.state
          && (!RTCSession.isActive() || message.state.final)) {
          applyOnlineSnapshot(message.state);
        }
        break;
      case "pong":
        Latency.receive(message.t, "relay");
        break;
      case "latency-ping":
        Network.send({ type: "latency-pong", t: message.t });
        break;
      case "latency-pong":
        Latency.receive(message.t, "relay");
        break;
      case "rtc-offer":
        if (typeof message.sdp === "string") RTCSession.handleOffer(message.sdp);
        break;
      case "rtc-answer":
        if (typeof message.sdp === "string") RTCSession.handleAnswer(message.sdp);
        break;
      case "rtc-ice":
        RTCSession.addIce(message.candidate);
        break;
      case "rtc-active":
        RTCSession.activate();
        break;
      case "rtc-inactive":
        RTCSession.deactivate();
        break;
      case "matchOver":
        if (!online) break;
        online.phase = "result";
        online.rematch = { host: false, guest: false };
        if (message.deadline) {
          online.rematchDeadline = message.deadline;
          if (battle && battle.phase === "over" && ui.resultOverlay.classList.contains("is-open")) {
            setResultChoiceDeadline(message.deadline);
          }
        }
        if (battle && battle.online && !ui.resultOverlay.classList.contains("is-open")) {
          finishBattle();
        }
        break;
      case "rematchStatus":
        if (!online) break;
        online.rematch = {
          host: !!message.hostRequested,
          guest: !!message.guestRequested
        };
        if (message.deadline) online.rematchDeadline = message.deadline;
        if (battle && battle.phase === "over" && resultChoiceMode === "online") {
          updateResultChoiceTimer();
        }
        break;
      case "rematchStart":
        clearResultChoiceTimer();
        if (ui.rematchTimer) ui.rematchTimer.hidden = true;
        setOverlay(ui.resultOverlay, false);
        if (online) {
          online.phase = "battle";
          online.rematch = { host: false, guest: false };
          online.rematchDeadline = 0;
        }
        startOnlineBattle(message.hostChar, message.guestChar);
        break;
      case "rematchClosed":
        clearResultChoiceTimer();
        if (ui.rematchTimer) ui.rematchTimer.hidden = true;
        setOverlay(ui.resultOverlay, false);
        if (online) online.phase = "ended";
        showToast(message.reason === "timeout"
          ? "双方未在 15 秒内同意再战，对战结束"
          : "对战已结束", 1800);
        returnToSelect();
        break;
      case "opponentLeft":
        handleOpponentLeft();
        break;
      case "error":
        setOnlineBusy(false);
        setOnlineNote(message.message || "联机服务发生错误。", true);
        if (!online) ui.onlineEntry.hidden = false;
        break;
      default:
        break;
    }
  }

  /* ═══════════════════════════════════════════════════════
     Settings, welcome notice & author support
     ═══════════════════════════════════════════════════════ */
  const NOTICE_SEEN_KEY = "ai-arena-notice-seen-v1.3.0";
  let activeSettingsTab = "volume";
  let pendingAutoJoin = false;

  function isDialogOpen() {
    return ui.noticeOverlay.classList.contains("is-open")
      || ui.settingsOverlay.classList.contains("is-open");
  }

  function syncModalBodyState() {
    const open = ui.noticeOverlay.classList.contains("is-open")
      || ui.settingsOverlay.classList.contains("is-open");
    document.body.classList.toggle("modal-open", open);
  }

  function syncAudioControls() {
    if (!ui.volumeSlider) return;
    const value = Math.round(clamp(AudioEngine.volume, 0, 100));
    ui.volumeSlider.value = String(value);
    ui.volumeValue.textContent = `${value}%`;
    ui.settingsSoundToggle.textContent = AudioEngine.enabled ? "关闭音效" : "开启音效";
    if (!AudioEngine.enabled) {
      ui.volumeHint.textContent = "音效已关闭。点击「开启音效」恢复，音量设置会保留。";
    } else if (value <= 0) {
      ui.volumeHint.textContent = "当前为静音。拖动滑杆即可恢复声音。";
    } else {
      ui.volumeHint.textContent = `当前音效音量 ${value}%。设置会自动保存在本机。`;
    }
  }

  function syncFullscreenUi() {
    const active = !!document.fullscreenElement;
    if (ui.fullscreenBtn) {
      const label = ui.fullscreenBtn.querySelector("span");
      if (label) label.textContent = active ? "退出" : "全屏";
      ui.fullscreenBtn.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (ui.settingsFullscreenBtn) {
      ui.settingsFullscreenBtn.textContent = active ? "退出全屏" : "进入全屏";
    }
  }

  async function enterFullscreen() {
    if (document.fullscreenElement) return;
    if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) return;
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      /* Browsers can reject fullscreen outside a user gesture. */
    }
    syncFullscreenUi();
  }

  async function exitAppFullscreen() {
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch (e) { /* ignore */ }
    syncFullscreenUi();
  }

  async function toggleFullscreen() {
    AudioEngine.play("ui");
    if (document.fullscreenElement) await exitAppFullscreen();
    else await enterFullscreen();
    syncFullscreenUi();
  }


  function setSettingsTab(tab) {
    const valid = ["volume", "keys", "author", "notice"];
    activeSettingsTab = valid.includes(tab) ? tab : "volume";
    for (const button of ui.settingsTabs) {
      const active = button.dataset.settingsTab === activeSettingsTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const panel of ui.settingsPanels) {
      panel.hidden = panel.dataset.settingsPanel !== activeSettingsTab;
    }
    if (activeSettingsTab === "volume") syncAudioControls();
  }

  function setNoticePage(page) {
    const target = page === "author" ? "author" : "notice";
    for (const button of ui.noticeTabs) {
      const active = button.dataset.noticeTab === target;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const panel of ui.noticePages) {
      const active = panel.dataset.noticePage === target;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    }
    const activeTab = ui.noticeTabs.find((button) => button.dataset.noticeTab === target);
    if (activeTab) {
      if (ui.noticeTitle) ui.noticeTitle.textContent = activeTab.dataset.title || "游戏须知";
      if (ui.noticeTagline) ui.noticeTagline.textContent = activeTab.dataset.tagline || "";
      if (ui.noticeRailCopy) ui.noticeRailCopy.textContent = activeTab.dataset.rail || "";
    }
  }

  function openSettings(tab = "volume") {
    if (battle && battleScreen.classList.contains("is-active")) return;
    AudioEngine.unlock();
    AudioEngine.play("ui");
    ui.noticeOverlay.classList.remove("is-open");
    ui.noticeOverlay.setAttribute("aria-hidden", "true");
    ui.settingsOverlay.classList.add("is-open");
    ui.settingsOverlay.setAttribute("aria-hidden", "false");
    setSettingsTab(tab);
    syncAudioControls();
    syncModalBodyState();
    window.setTimeout(() => ui.settingsCloseBtn.focus({ preventScroll: true }), 80);
  }

  function closeSettings() {
    ui.settingsOverlay.classList.remove("is-open");
    ui.settingsOverlay.setAttribute("aria-hidden", "true");
    syncModalBodyState();
  }

  function openNotice() {
    AudioEngine.play("ui");
    ui.settingsOverlay.classList.remove("is-open");
    ui.settingsOverlay.setAttribute("aria-hidden", "true");
    setNoticePage("notice");
    ui.noticeOverlay.classList.add("is-open");
    ui.noticeOverlay.setAttribute("aria-hidden", "false");
    syncModalBodyState();
    window.setTimeout(() => ui.noticeEnterBtn.focus({ preventScroll: true }), 80);
  }

  function closeNotice(markSeen = true) {
    ui.noticeOverlay.classList.remove("is-open");
    ui.noticeOverlay.setAttribute("aria-hidden", "true");
    if (markSeen) {
      try { localStorage.setItem(NOTICE_SEEN_KEY, "1"); } catch (e) { /* privacy mode */ }
    }
    syncModalBodyState();
    if (pendingAutoJoin) {
      pendingAutoJoin = false;
      window.setTimeout(() => {
        if (!online) connectAndJoinRoom();
      }, 260);
    }
  }

  function shouldShowWelcomeNotice() {
    try {
      return localStorage.getItem(NOTICE_SEEN_KEY) !== "1";
    } catch (e) {
      return true;
    }
  }

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        return ok;
      } catch (err) {
        return false;
      }
    }
  }

  function bindCopyChip(button) {
    button.addEventListener("click", async () => {
      const text = button.dataset.copy || "";
      if (!text) return;
      const oldText = button.textContent;
      const ok = await copyTextToClipboard(text);
      button.textContent = ok ? "已复制" : "复制失败";
      button.classList.toggle("is-copied", ok);
      window.setTimeout(() => {
        button.textContent = oldText;
        button.classList.remove("is-copied");
      }, 1300);
    });
  }

  /* ═══════════════════════════════════════════════════════
     Selection screen
     ═══════════════════════════════════════════════════════ */
  function buildRoster() {
    ui.rosterList.innerHTML = CHARACTERS.map((c, index) => `
      <button type="button" class="roster-card" data-id="${c.id}" aria-pressed="false"
        style="--card-accent:${c.color};--card-accent-rgb:${c.accentRgb};">
        <span class="roster-index">${pad2(index + 1)}</span>
        <span class="roster-thumb"><img src="${c.image}" alt="" loading="eager"></span>
        <span class="roster-info">
          <span class="roster-name-line">
            <span class="roster-name">${c.name}</span>
            <span class="roster-id">${c.serial.replace(" // ", "")}</span>
          </span>
          <span class="roster-title">${c.title}</span>
          <span class="roster-role">${c.role}</span>
        </span>
        <span class="roster-damage"><strong>${c.normal.damage}</strong><small>ATK</small></span>
        <span class="roster-chevron">›</span>
      </button>
    `).join("");

    ui.rosterList.addEventListener("click", (event) => {
      const card = event.target.closest(".roster-card");
      if (!card) return;
      selectCharacter(card.dataset.id);
    });
  }

  function updateDescriptionModeButton() {
    if (!ui.descModeBtn) return;
    ui.descModeBtn.classList.toggle("is-active", compactDescriptions);
    ui.descModeBtn.setAttribute("aria-pressed", compactDescriptions ? "true" : "false");
    ui.descModeBtn.querySelector("span").textContent = compactDescriptions ? "简略模式" : "完整模式";
    document.body.classList.toggle("compact-moves", compactDescriptions);
  }

  function refreshDescriptionTexts(c = BY_ID[selectedId]) {
    if (!c) return;
    ui.normalDesc.textContent = compactDescriptions ? (c.normal.shortDesc || c.normal.desc) : c.normal.desc;
    ui.skillDesc.textContent = compactDescriptions ? (c.skill.shortDesc || c.skill.desc) : c.skill.desc;
    ui.passiveDesc.textContent = compactDescriptions ? (c.passive.shortDesc || c.passive.desc) : c.passive.desc;
    updateDescriptionModeButton();
  }

  function setDescriptionMode(compact) {
    compactDescriptions = !!compact;
    try { localStorage.setItem("ai-arena-description-mode", compactDescriptions ? "compact" : "full"); } catch (e) {}
    refreshDescriptionTexts();
  }

  function selectCharacter(id, options = {}) {
    if (online && online.phase === "selecting" && online.locked) return;
    const c = BY_ID[id] || BY_ID.deepseek;
    selectedId = c.id;
    const index = CHARACTERS.findIndex((item) => item.id === c.id);
    const normal = c.normal;
    const skill = c.skill;

    ui.profilePanel.style.setProperty("--accent", c.color);
    ui.profilePanel.style.setProperty("--accent-rgb", c.accentRgb);
    ui.profilePanel.style.setProperty("--accent-soft", `rgba(${c.accentRgb}, .18)`);

    ui.heroNum.textContent = pad2(index + 1);
    ui.heroName.textContent = c.name;
    ui.heroRole.textContent = c.role;
    ui.heroTitle.textContent = c.title;
    ui.heroMeme.textContent = `#${c.meme}`;
    ui.heroQuote.textContent = c.quote;
    ui.counterName.textContent = c.counterName || "—";
    ui.counterDesc.textContent = c.matchup || "";
    ui.counteredBy.textContent = c.counteredByName ? `被${c.counteredByName}微克` : "无被克制";
    ui.matchupCard.style.setProperty("--counter-accent", c.color);
    ui.passiveName.textContent = c.passive.name;
    ui.artIndex.textContent = pad2(index + 1);
    ui.artSerial.textContent = c.serial;
    ui.artSubline.textContent = c.subline;

    ui.statHp.textContent = c.hpMax;
    ui.statToken.textContent = c.tokenMax;
    ui.statRegen.textContent = `↻ ${c.tokenRegen} / 秒`;
    ui.statDamage.textContent = normal.damage;
    ui.statCrit.textContent = `${Math.round(c.crit * 100)}%`;
    ui.statDodge.textContent = `${Math.round(c.dodge * 100)}%`;
    ui.statHpBar.style.width = `${clamp((c.hpMax / 1200) * 100, 15, 100)}%`;
    ui.statTokenBar.style.width = `${clamp((c.tokenMax / 100) * 100, 15, 100)}%`;
    ui.statDamageBar.style.width = `${clamp((normal.damage / 40) * 100, 15, 100)}%`;
    ui.statCritBar.style.width = `${clamp((c.crit / 0.25) * 100, 12, 100)}%`;
    ui.statDodgeBar.style.width = `${clamp((c.dodge / 0.2) * 100, 12, 100)}%`;

    ui.normalName.textContent = normal.name;
    ui.normalMeta.textContent = `${normal.cooldown.toFixed(2)}s / 次`;
    ui.skillName.textContent = skill.name;
    ui.skillMeta.textContent = `${skill.cost} TOKEN`;
    ui.skillCd.textContent = `${skill.cooldown}s`;
    ui.skillTag.textContent = skill.meme;
    refreshDescriptionTexts(c);

    if (ui.heroImg.getAttribute("src") !== c.image) {
      ui.heroImg.src = c.image;
      const art = $(".profile-art");
      art.classList.remove("is-swapping");
      void art.offsetWidth;
      art.classList.add("is-swapping");
    }
    ui.heroImg.alt = `${c.name} AI 娘立绘`;
    ui.heroImg.classList.toggle("is-compact", c.id === "doubao");

    $$(".roster-card", ui.rosterList).forEach((card) => {
      const active = card.dataset.id === c.id;
      card.classList.toggle("is-selected", active);
      card.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (!options.silent) AudioEngine.play("ui");
    if (online && online.phase === "selecting" && !online.locked) {
      Network.send({ type: "select", charId: selectedId });
      if (ui.onlineMyPick) ui.onlineMyPick.textContent = c.name;
    }
  }

  function preloadArt() {
    CHARACTERS.forEach((c) => {
      const img = new Image();
      img.decoding = "async";
      img.src = c.image;
      imageCache[c.id] = img;
      if (c.formImage) {
        const formImg = new Image();
        formImg.decoding = "async";
        formImg.src = c.formImage;
        imageCache[`${c.id}-form`] = formImg;
      }
      // 移动帧精灵图（左右两个朝向，横向条带，每格等宽）
      if (c.walk) {
        ["left", "right"].forEach((dir) => {
          const sheet = new Image();
          sheet.decoding = "async";
          sheet.src = c.walk.sheet.replace("{dir}", dir);
          imageCache[`${c.id}-walk-${dir}`] = sheet;
        });
      }
    });
  }

  /* ═══════════════════════════════════════════════════════
     Announcements & toast
     ═══════════════════════════════════════════════════════ */
  function announce(text, sub = "", variant = "", duration = 820) {
    const el = ui.announce;
    window.clearTimeout(announceTimer);
    el.className = "announce";
    el.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = text;
    el.appendChild(strong);
    if (sub) {
      const small = document.createElement("small");
      small.textContent = sub;
      el.appendChild(small);
    }
    if (variant) el.classList.add(variant);
    void el.offsetWidth;
    el.classList.add("is-showing");
    announceTimer = window.setTimeout(() => {
      el.classList.remove("is-showing");
    }, duration);
  }

  function showToast(text, duration = 1050) {
    const el = ui.hudToast;
    el.textContent = text;
    el.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove("is-visible"), duration);
  }

  function showPassiveBanner(title, subtitle = "", duration = 1900) {
    const el = ui.passiveBanner;
    if (!el) return;
    el.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent = subtitle;
    el.appendChild(strong);
    el.appendChild(small);
    el.classList.remove("is-showing");
    void el.offsetWidth;
    el.classList.add("is-showing");
    window.clearTimeout(passiveBannerTimer);
    passiveBannerTimer = window.setTimeout(() => el.classList.remove("is-showing"), duration);
  }

  /* ═══════════════════════════════════════════════════════
     Screens & overlays
     ═══════════════════════════════════════════════════════ */
  function setOverlay(el, open) {
    el.classList.toggle("is-open", open);
    el.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function closeOverlays() {
    setOverlay(ui.pauseOverlay, false);
    setOverlay(ui.resultOverlay, false);
  }

  function showSelect() {
    battle = null;
    keys.clear();
    closeOverlays();
    battleScreen.classList.remove("is-active");
    battleScreen.setAttribute("aria-hidden", "true");
    selectScreen.classList.add("is-active");
    selectScreen.removeAttribute("aria-hidden");
    document.body.classList.remove("is-battling");
    ui.announce.className = "announce";
    ui.announce.innerHTML = "";
  }

  /* ═══════════════════════════════════════════════════════
     Canvas resize
     ═══════════════════════════════════════════════════════ */
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }

  /* ═══════════════════════════════════════════════════════
     Battle construction
     ═══════════════════════════════════════════════════════ */
  function createFighter(char, options) {
    return {
      char,
      isAI: !!options.isAI,
      x: options.x,
      y: GROUND_Y,
      vx: 0,
      vy: 0,
      facing: options.facing,
      support: "ground",
      walkPhase: 0,
      hp: char.hpMax,
      token: STARTING_TOKEN,
      normalCd: 0,
      skillCd: 0,
      action: null,
      stun: 0,
      rootTimer: 0,
      guardTimer: 0,
      rangeCharges: 0,
      rapidNormalCharges: 0,
      hitstun: 0,
      hurtFlash: 0,
      dodgeFlash: 0,
      jumpBuffer: 0,
      dashBuffer: 0,
      alive: true,
      koTime: 0,
      koRotation: 0,
      koDirection: 1,
      idleSeed: Math.random() * Math.PI * 2,
      dashCd: 0,
      dashTimer: 0,
      dashDir: options.facing,
      dashKeepFacing: 0,
      invulnTimer: 0,
      passiveCd: 0,
      passiveUsed: false,
      passiveNotified: false,
      entryBlockUsed: false,
      backlashTimer: 0,
      milkTimer: 0,
      slowTimer: 0,
      slowFactor: 0,
      hasteTimer: 0,
      hasteFactor: 0,
      attackSpeedTimer: 0,
      attackSpeedFactor: 0,
      lifestealTimer: 0,
      lifestealRate: 0
    };
  }

  function createBattle(playerId, forcedEnemyId = null, options = {}) {
    const playerChar = BY_ID[playerId] || CHARACTERS[0];
    const available = CHARACTERS.filter((c) => c.id !== playerChar.id);
    const enemyChar = (forcedEnemyId && forcedEnemyId !== playerChar.id && BY_ID[forcedEnemyId])
      || available[Math.floor(Math.random() * available.length)];
    const difficulty = options.difficulty && AI_DIFFICULTIES[options.difficulty] ? options.difficulty : "easy";
    const aiConf = AI_DIFFICULTIES[difficulty];

    const player = createFighter(playerChar, { x: 270, facing: 1, isAI: false });
    const enemy = createFighter(enemyChar, { x: 1010, facing: -1, isAI: true });

    return {
      player,
      enemy,
      localFighter: player,
      phase: "countdown",
      countdown: 3.0,
      lastCountdown: 3,
      timeLeft: 99,
      elapsed: 0,
      visualTime: 0,
      winner: null,
      reason: null,
      endingTimer: 0,
      lateRegenAnnounced: false,
      online: null,
      projectiles: [],
      strikes: [],
      particles: [],
      floats: [],
      rings: [],
      pickups: [],
      shake: 0,
      hitFlash: 0,
      hitStop: 0,
      hitLog: [],
      ai: {
        difficulty,
        conf: aiConf,
        decisionIn: 0.9,
        skillLockout: aiConf.initialLockout,
        controls: { left: false, right: false },
        strafe: Math.random() < 0.5 ? -1 : 1
      },
      stats: {
        player: { damage: 0, crits: 0, dodges: 0, skills: 0, dashes: 0 },
        enemy: { damage: 0, crits: 0, dodges: 0, skills: 0, dashes: 0 }
      },
      fxTick: 0
    };
  }

  function startBattle(playerId = selectedId, forcedEnemyId = null, options = {}) {
    selectedId = BY_ID[playerId] ? playerId : selectedId;
    enterFullscreen();
    clearResultChoiceTimer();
    Latency.stop();
    if (ui.rematchTimer) ui.rematchTimer.hidden = true;
    RTCSession.close();
    if (ui.netBadge) ui.netBadge.hidden = true;
    AudioEngine.unlock();
    AudioEngine.play("ui");
    hudCache.clear();
    const difficulty = options.difficulty && AI_DIFFICULTIES[options.difficulty]
      ? options.difficulty
      : selectedDifficulty;
    battle = createBattle(selectedId, forcedEnemyId, { difficulty });
    battle.localFighter = battle.player;
    battle.visualTime = performance.now() / 1000;
    battleShell.classList.remove("online-guest");
    ui.pauseBtn.style.display = "";
    ui.rematchBtn.style.display = "";
    ui.changeBtn.textContent = "更换角色";
    if (options.fast) battle.countdown = 0.12;

    closeOverlays();
    setupBattleUi(battle);
    ui.playerAvatarTag.textContent = "YOU";
    ui.enemyAvatarTag.textContent = "AI";
    selectScreen.classList.remove("is-active");
    selectScreen.setAttribute("aria-hidden", "true");
    battleScreen.classList.add("is-active");
    battleScreen.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-battling");

    keys.clear();
    ui.announce.className = "announce";
    ui.announce.innerHTML = "";
    ui.passiveBanner.classList.remove("is-showing");
    window.clearTimeout(passiveBannerTimer);
    if (!options.fast) {
      window.setTimeout(() => {
        announce("3", `${battle.player.char.name}  VS  ${battle.enemy.char.name}`, "is-countdown", 760);
        AudioEngine.play("count");
      }, 120);
    }
    updateHud(battle);
  }

  function startOnlineBattle(hostChar, guestChar) {
    if (!online) return;
    const role = online.role;
    hudCache.clear();
    stopOnlineUiTimer();
    const b = createBattle(hostChar, guestChar, { difficulty: "easy" });
    b.phase = "fighting";
    b.countdown = 0;
    b.timeLeft = 99;
    b.localFighter = role === "host" ? b.player : b.enemy;
    b.player.isAI = false;
    b.enemy.isAI = false;
    b.online = {
      role,
      remoteControls: { left: false, right: false },
      lastSnapshotAt: 0,
      lastReceivedAt: 0
    };
    battle = b;
    battle.visualTime = performance.now() / 1000;
    online.phase = "battle";
    online.rematchDeadline = 0;
    online.rematch = { host: false, guest: false };
    clearResultChoiceTimer();
    if (ui.rematchTimer) ui.rematchTimer.hidden = true;
    if (ui.rematchBtn) {
      ui.rematchBtn.disabled = false;
      ui.rematchBtn.textContent = "再战一局";
      ui.rematchBtn.style.display = "";
    }
    if (ui.changeBtn) {
      ui.changeBtn.disabled = false;
      ui.changeBtn.textContent = "结束";
    }

    if (ui.netBadge) ui.netBadge.hidden = false;
    RTCSession.setBadge("connecting");
    if (role === "host") RTCSession.startHost();
    else RTCSession.startGuest();

    closeOverlays();
    setupBattleUi(b);
    ui.playerAvatarTag.textContent = role === "host" ? "YOU" : "P1";
    ui.enemyAvatarTag.textContent = role === "guest" ? "YOU" : "P2";
    ui.pauseBtn.style.display = "none";
    ui.rematchBtn.style.display = "none";
    ui.changeBtn.textContent = "返回大厅";
    ui.resultOverlay.classList.remove("is-open");
    battleShell.classList.toggle("online-guest", role === "guest");

    selectScreen.classList.remove("is-active");
    selectScreen.setAttribute("aria-hidden", "true");
    battleScreen.classList.add("is-active");
    battleScreen.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-battling");
    keys.clear();
    ui.announce.className = "announce";
    ui.announce.innerHTML = "";
    ui.passiveBanner.classList.remove("is-showing");
    announce("开战", `${b.player.char.name}  VS  ${b.enemy.char.name}`, "is-fight", 1100);
    AudioEngine.play("fight");
    updateHud(b);
    Latency.start();
  }

  function handleOnlineMatchStart(message) {
    if (!online) return;
    if (!BY_ID[message.hostChar] || !BY_ID[message.guestChar]) return;
    stopOnlineUiTimer();
    startOnlineBattle(message.hostChar, message.guestChar);
  }

  function applyRemoteInput(message) {
    const b = battle;
    if (!b || !b.online || b.online.role !== "host") return;
    if (message.action === "left" || message.action === "right") {
      if (message.action === "left") b.online.remoteControls.left = !!message.down;
      else b.online.remoteControls.right = !!message.down;
      return;
    }
    if (b.phase !== "fighting") return;
    const guest = b.enemy;
    if (!guest.alive) return;
    switch (message.action) {
      case "jump":
        guest.jumpBuffer = 0.13;
        break;
      case "normal":
        tryNormal(guest, b);
        break;
      case "skill":
        trySkill(guest, b);
        break;
      case "dash":
        tryDash(guest, b);
        break;
      default:
        break;
    }
  }

  function serializeFighter(fighter) {
    return {
      charId: fighter.char.id,
      x: fighter.x,
      y: fighter.y,
      vx: fighter.vx,
      vy: fighter.vy,
      facing: fighter.facing,
      support: fighter.support,
      hp: fighter.hp,
      token: fighter.token,
      normalCd: fighter.normalCd,
      skillCd: fighter.skillCd,
      action: fighter.action ? { ...fighter.action } : null,
      stun: fighter.stun,
      rootTimer: fighter.rootTimer,
      guardTimer: fighter.guardTimer,
      invulnTimer: fighter.invulnTimer,
      hitstun: fighter.hitstun,
      hurtFlash: fighter.hurtFlash,
      dodgeFlash: fighter.dodgeFlash,
      jumpBuffer: fighter.jumpBuffer,
      milkTimer: fighter.milkTimer,
      alive: fighter.alive,
      koTime: fighter.koTime,
      koRotation: fighter.koRotation,
      koDirection: fighter.koDirection,
      passiveNotified: fighter.passiveNotified,
      passiveUsed: fighter.passiveUsed,
      entryBlockUsed: fighter.entryBlockUsed,
      passiveCd: fighter.passiveCd,
      backlashTimer: fighter.backlashTimer,
      rangeCharges: fighter.rangeCharges,
      rapidNormalCharges: fighter.rapidNormalCharges,
      slowTimer: fighter.slowTimer,
      slowFactor: fighter.slowFactor,
      hasteTimer: fighter.hasteTimer,
      hasteFactor: fighter.hasteFactor,
      attackSpeedTimer: fighter.attackSpeedTimer,
      attackSpeedFactor: fighter.attackSpeedFactor,
      lifestealTimer: fighter.lifestealTimer,
      lifestealRate: fighter.lifestealRate
    };
  }

  function serializeOnlineBattle(b) {
    return {
      phase: b.phase,
      timeLeft: b.timeLeft,
      elapsed: b.elapsed,
      winner: b.winner,
      reason: b.reason,
      endingTimer: b.endingTimer,
      shake: b.shake,
      hitFlash: b.hitFlash,
      player: serializeFighter(b.player),
      enemy: serializeFighter(b.enemy),
      stats: {
        player: { ...b.stats.player },
        enemy: { ...b.stats.enemy }
      },
      projectiles: b.projectiles.slice(0, 20).map((p) => ({
        type: p.type,
        kind: p.kind,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        angle: p.angle,
        w: p.w,
        h: p.h,
        life: p.life,
        age: p.age,
        color: p.color,
        empowered: !!p.empowered,
        variant: p.variant
      })),
      strikes: b.strikes.slice(0, 6).map((s) => ({
        type: s.type,
        x: s.x,
        y: s.y,
        originX: s.originX,
        facing: s.facing,
        length: s.length,
        t: s.t,
        delay: s.delay,
        linger: s.linger,
        hitDone: s.hitDone,
        radius: s.radius,
        height: s.height,
        color: s.color,
        center: !!s.center
      })),
      pickups: b.pickups.slice(0, 6).map((p) => ({
        x: p.x,
        y: p.y,
        life: p.life,
        maxLife: p.maxLife,
        color: p.color
      })),
      // Particles are cosmetic and make state packets much larger.
      // They stay local to the host; rings and damage numbers are kept.
      rings: b.rings.slice(-6).map((r) => ({
        x: r.x, y: r.y, color: r.color, maxRadius: r.maxRadius, width: r.width, age: r.age, life: r.life
      })),
      floats: b.floats.slice(-12).map((f) => ({
        x: f.x, y: f.y, text: f.text, color: f.color, size: f.size, age: f.age, life: f.life
      }))
    };
  }

  function maybeSendOnlineSnapshot(now) {
    const b = battle;
    if (!b || !b.online || b.online.role !== "host") return;
    if (b.online.statePaused) return;
    if (!Network.connected) return;
    // 局域网 / P2P 直连时带宽充足，提到 60Hz 让访客画面更顺；
    // 走公网中继时仍保持 30Hz，避免塞爆隧道。
    const interval = RTCSession.active ? 16 : 33;
    if (now - (b.online.lastSnapshotAt || 0) < interval) return;
    b.online.lastSnapshotAt = now;
    Network.sendGame({ type: "state", state: serializeOnlineBattle(b) });
  }

  function applyFighterSnapshot(fighter, data) {
    if (!data) return;
    const char = BY_ID[data.charId] || fighter.char;
    fighter.char = char;
    fighter.isAI = false;
    // 位置交给 applyOnlineSnapshot 做插值，这里不再硬赋值
    fighter.vx = data.vx;
    fighter.vy = data.vy;
    fighter.facing = data.facing;
    fighter.support = data.support;
    fighter.hp = data.hp;
    fighter.token = data.token;
    fighter.normalCd = data.normalCd;
    fighter.skillCd = data.skillCd;
    fighter.action = data.action ? { ...data.action } : null;
    fighter.stun = data.stun;
    fighter.rootTimer = data.rootTimer;
    fighter.guardTimer = data.guardTimer;
    fighter.invulnTimer = data.invulnTimer;
    fighter.hitstun = data.hitstun;
    fighter.hurtFlash = data.hurtFlash;
    fighter.dodgeFlash = data.dodgeFlash;
    fighter.jumpBuffer = data.jumpBuffer;
    fighter.milkTimer = data.milkTimer;
    fighter.alive = data.alive;
    fighter.koTime = data.koTime;
    fighter.koRotation = data.koRotation;
    fighter.koDirection = data.koDirection;
    fighter.passiveNotified = data.passiveNotified;
    fighter.passiveUsed = data.passiveUsed;
    fighter.entryBlockUsed = data.entryBlockUsed;
    fighter.passiveCd = data.passiveCd;
    fighter.backlashTimer = data.backlashTimer || 0;
    fighter.rangeCharges = data.rangeCharges;
    fighter.rapidNormalCharges = data.rapidNormalCharges;
    fighter.slowTimer = data.slowTimer || 0;
    fighter.slowFactor = data.slowFactor || 0;
    fighter.hasteTimer = data.hasteTimer || 0;
    fighter.hasteFactor = data.hasteFactor || 0;
    fighter.attackSpeedTimer = data.attackSpeedTimer || 0;
    fighter.attackSpeedFactor = data.attackSpeedFactor || 0;
    fighter.lifestealTimer = data.lifestealTimer || 0;
    fighter.lifestealRate = data.lifestealRate || 0;
  }

  function applyOnlineSnapshot(state) {
    const b = battle;
    if (!b || !b.online || b.online.role !== "guest") return;
    b.online.lastReceivedAt = performance.now();

    /* 位置采用插值而不是硬赋值：
       记录"目标位置"，由渲染循环每帧向它平滑靠拢。
       直接赋值会让每帧快照造成一次瞬移，在手机上尤其明显（画面一顿一顿）。 */
    const targets = [
      [b.player, state.player],
      [b.enemy, state.enemy]
    ];
    for (const [fighter, data] of targets) {
      if (!data) continue;
      const dist = Math.hypot((data.x || 0) - fighter.x, (data.y || 0) - fighter.y);
      // 距离过大（重生、传送、开局）才直接对齐，避免插值拖影
      if (dist > 260 || !fighter.netTarget) {
        fighter.x = data.x;
        fighter.y = data.y;
      }
      fighter.netTarget = { x: data.x, y: data.y };
    }

    b.phase = state.phase;
    b.timeLeft = state.timeLeft;
    b.elapsed = state.elapsed;
    b.winner = state.winner;
    b.reason = state.reason;
    b.endingTimer = state.endingTimer;
    b.shake = state.shake;
    b.hitFlash = state.hitFlash;
    applyFighterSnapshot(b.player, state.player);
    applyFighterSnapshot(b.enemy, state.enemy);
    b.localFighter = b.enemy;
    b.stats = {
      player: { ...state.stats.player },
      enemy: { ...state.stats.enemy }
    };
    b.projectiles = state.projectiles || [];
    b.strikes = state.strikes || [];
    b.pickups = state.pickups || [];
    b.particles = [];
    b.rings = state.rings || [];
    b.floats = state.floats || [];

    if (b.phase === "over" && !ui.resultOverlay.classList.contains("is-open")) {
      finishBattle();
    }
  }

  function setupBattleUi(b) {
    const p = b.player.char;
    const e = b.enemy.char;
    battleShell.style.setProperty("--accent", p.color);
    battleShell.style.setProperty("--accent-rgb", p.accentRgb);
    battleShell.style.setProperty("--accent-soft", `rgba(${p.accentRgb}, .18)`);

    ui.playerAvatar.src = p.image;
    ui.enemyAvatar.src = e.image;
    ui.playerAvatar.style.objectPosition = p.id === "doubao" ? "50% 16%" : "50% 14%";
    ui.enemyAvatar.style.objectPosition = e.id === "doubao" ? "50% 16%" : "50% 14%";
    ui.playerHudName.textContent = p.name;
    ui.enemyHudName.textContent = e.name;
    ui.playerHudTag.textContent = p.title;
    ui.enemyHudTag.textContent = `${e.title} · AI`;

    ui.abilityNormalName.textContent = p.normal.name;
    ui.abilitySkillName.textContent = p.skill.name;
    ui.abilitySkillCost.textContent = `${p.skill.cost} TOKEN`;
    ui.guideSkillName.textContent = p.skill.name;

    ui.playerHpText.textContent = `${Math.ceil(b.player.hp)} / ${p.hpMax}`;
    ui.enemyHpText.textContent = `${Math.ceil(b.enemy.hp)} / ${e.hpMax}`;
    ui.playerHpFill.style.width = "100%";
    ui.enemyHpFill.style.width = "100%";
    ui.playerTokenFill.style.width = `${(b.player.token / p.tokenMax) * 100}%`;
    ui.enemyTokenFill.style.width = `${(b.enemy.token / e.tokenMax) * 100}%`;
    ui.playerTokenText.textContent = `${Math.floor(b.player.token)}`;
    ui.enemyTokenText.textContent = `${Math.floor(b.enemy.token)}`;
    ui.timerText.textContent = "99";
    ui.normalAbility.classList.remove("is-cooling", "is-no-token");
    ui.skillAbility.classList.remove("is-cooling", "is-no-token");
  }

  /* ═══════════════════════════════════════════════════════
     Input
     ═══════════════════════════════════════════════════════ */
  function handleSelectKey(event) {
    if (!selectScreen.classList.contains("is-active")) return false;
    if (online && online.phase === "selecting") {
      if (/^Digit[1-5]$/.test(event.code)) {
        event.preventDefault();
        if (!online.locked) {
          const index = Number(event.code.slice(-1)) - 1;
          selectCharacter(CHARACTERS[index].id);
        }
        return true;
      }
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        event.preventDefault();
        confirmOnlineSelection(false);
        return true;
      }
      return false;
    }
    if (online) return false;
    if (/^Digit[1-5]$/.test(event.code)) {
      event.preventDefault();
      const index = Number(event.code.slice(-1)) - 1;
      selectCharacter(CHARACTERS[index].id);
      return true;
    }
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      if (document.activeElement && document.activeElement.classList.contains("roster-card")) {
        return false;
      }
      event.preventDefault();
      if (selectedMode === "ai") {
        startBattle(selectedId, null, { difficulty: selectedDifficulty });
      }
      return true;
    }
    return false;
  }

  /* 战斗输入的统一入口：键盘与触屏都走这里。
     code 用 "KeyA"/"KeyD"/"Space"/"KeyJ"/"KeyK"/"KeyH"；
     down 只对 "KeyA"/"KeyD" 有意义（按住移动）。
     访客端的所有输入都会通过 WebSocket 转发给房主。 */
  function dispatchBattleInput(code, down = true) {
    const b = battle;
    if (!b) return false;

    // ── 联机访客：把输入发给房主模拟 ──
    if (b.online && b.online.role === "guest") {
      if (code === "KeyA" || code === "KeyD") {
        Network.sendGame({ type: "input", action: code === "KeyA" ? "left" : "right", down });
        return true;
      }
      if (!down) return true;
      if (b.phase !== "fighting" || ui.resultOverlay.classList.contains("is-open")) return true;
      const sendAction = (action) => Network.sendGame({ type: "input", action });
      switch (code) {
        case "Space": sendAction("jump"); AudioEngine.play("key"); break;
        case "KeyJ":
          sendAction("normal");
          AudioEngine.play(b.localFighter.char.normal.type === "melee" ? "swing" : "shot");
          break;
        case "KeyK": sendAction("skill"); AudioEngine.play("skill"); break;
        case "KeyH": sendAction("dash"); AudioEngine.play("dash"); break;
        default: break;
      }
      return true;
    }

    // ── 本地（单机 / 联机房主）──
    if (code === "KeyA" || code === "KeyD") {
      if (down) keys.add(code); else keys.delete(code);
      return true;
    }
    if (!down) return false;
    if (b.phase !== "fighting") return false;
    switch (code) {
      case "Space":
        b.player.jumpBuffer = 0.13;
        AudioEngine.play("key");
        break;
      case "KeyJ":
        tryNormal(b.player, b);
        break;
      case "KeyK":
        trySkill(b.player, b);
        break;
      case "KeyH":
        // 冲刺瞬发；若当前正在出招就进缓冲，动作一结束立刻接上，实现"冲+打"几乎同时。
        if (!tryDash(b.player, b)) b.player.dashBuffer = DASH_BUFFER_TIME;
        break;
      default:
        break;
    }
    return true;
  }

  function onKeyDown(event) {
    AudioEngine.unlock();

    if (isDialogOpen()) {
      if (event.code === "Escape") {
        event.preventDefault();
        if (ui.settingsOverlay.classList.contains("is-open")) closeSettings();
        else closeNotice();
      }
      return;
    }

    if (battleScreen.classList.contains("is-active") && battle) {
      if (battle.online && battle.online.role === "guest") {
        if (event.code === "Escape") {
          event.preventDefault();
          return;
        }
        if (["Space", "KeyA", "KeyD", "KeyJ", "KeyK", "KeyH"].includes(event.code)) {
          event.preventDefault();
        }
        if (event.repeat) return;
        dispatchBattleInput(event.code, true);
        return;
      }

      if (event.code === "Escape") {
        event.preventDefault();
        if (battle.online) return;
        if (battle.phase === "fighting") pauseBattle();
        else if (battle.phase === "paused") resumeBattle();
        return;
      }

      if (battle.phase === "over" && (event.code === "Enter" || event.code === "NumpadEnter")) {
        event.preventDefault();
        if (!battle.online) rematch();
        return;
      }

      if (["Space", "KeyA", "KeyD", "KeyJ", "KeyK", "KeyH"].includes(event.code)) {
        event.preventDefault();
      }

      if (event.repeat) return;
      dispatchBattleInput(event.code, true);
      return;
    }

    handleSelectKey(event);
  }

  function onKeyUp(event) {
    if (battle && battleScreen.classList.contains("is-active")) {
      if (event.code === "KeyA" || event.code === "KeyD") {
        dispatchBattleInput(event.code, false);
        return;
      }
    }
    if (event.code === "KeyA" || event.code === "KeyD") keys.delete(event.code);
  }

  function clearKeys() {
    keys.clear();
  }

  document.addEventListener("keydown", onKeyDown, { passive: false });
  document.addEventListener("keyup", onKeyUp);

  /* ═══════════════════════════════════════════════════════
     移动端触屏操作
     - 只在触屏设备上显示（CSS 用 pointer:coarse 控制）
     - 所有按键都走 dispatchBattleInput，与键盘完全同一条路径，
       所以单机、联机房主、联机访客三种身份自动都支持。
     ═══════════════════════════════════════════════════════ */
  (function bindTouchControls() {
    const pad = document.getElementById("touchPad");
    if (!pad) return;
    const buttons = [...pad.querySelectorAll("[data-touch]")];

    /* 触屏判定：只用"媒体查询说的粗指针"这一个可靠信号。
       注意：不要用 navigator.maxTouchPoints 或 screen 尺寸做判断——
       无头浏览器 / 部分桌面浏览器会上报 maxTouchPoints=10、screen=800×600，
       把电脑端误判成手机（已经踩过两次）。 */
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const isTouchDevice = coarsePointer;
    document.body.classList.toggle("is-touch", isTouchDevice);

    /* 兜底：如果媒体查询不准，等真实触摸事件发生时再补上。
       鼠标设备永远不会触发 touchstart，所以不会误伤电脑端。 */
    if (!isTouchDevice) {
      const enableOnFirstTouch = () => {
        document.body.classList.add("is-touch");
        document.body.classList.toggle("is-portrait", window.innerHeight > window.innerWidth);
        window.removeEventListener("touchstart", enableOnFirstTouch, true);
      };
      window.addEventListener("touchstart", enableOnFirstTouch, { capture: true, passive: true });
    }

    /* 竖屏检测：竖屏时收起触屏操作台（横屏才是正常游玩姿态） */
    const syncOrientation = () => {
      document.body.classList.toggle("is-portrait", window.innerHeight > window.innerWidth);
    };
    syncOrientation();
    window.addEventListener("resize", syncOrientation);
    window.addEventListener("orientationchange", () => setTimeout(syncOrientation, 120));

    // 记录每根手指按在哪个键上，多指同时按（如「冲刺 + 普攻」）也能正确释放
    const activePointers = new Map();

    const press = (btn, pointerId) => {
      const code = btn.dataset.touch;
      if (activePointers.has(pointerId)) return;
      activePointers.set(pointerId, { btn, code });
      btn.classList.add("is-down");
      AudioEngine.unlock();
      dispatchBattleInput(code, true);
    };

    const release = (pointerId) => {
      const entry = activePointers.get(pointerId);
      if (!entry) return;
      activePointers.delete(pointerId);
      entry.btn.classList.remove("is-down");
      // 只有左右移动是"按住"语义，其它按键松开不触发额外逻辑
      if (entry.code === "KeyA" || entry.code === "KeyD") {
        // 同一侧还有别的手指按住时不要松开
        const stillHeld = [...activePointers.values()].some((v) => v.code === entry.code);
        if (!stillHeld) dispatchBattleInput(entry.code, false);
      }
    };

    const releaseAll = () => {
      for (const id of [...activePointers.keys()]) release(id);
      dispatchBattleInput("KeyA", false);
      dispatchBattleInput("KeyD", false);
    };

    for (const btn of buttons) {
      btn.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        try { btn.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
        press(btn, event.pointerId);
      }, { passive: false });
      btn.addEventListener("pointerup", (event) => {
        event.preventDefault();
        release(event.pointerId);
      }, { passive: false });
      btn.addEventListener("pointercancel", (event) => release(event.pointerId));
      btn.addEventListener("lostpointercapture", (event) => release(event.pointerId));
      btn.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    // 切到后台 / 弹窗打开时松开所有键，避免"粘键"
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) releaseAll();
    });
    window.addEventListener("blur", releaseAll);

    // 暴露给运行时，方便在结算/暂停时统一清空
    window.__releaseAllTouch = releaseAll;
  })();
  window.addEventListener("blur", () => {
    clearKeys();
    if (battle && battle.online && battle.online.role === "guest") {
      Network.sendGame({ type: "input", action: "left", down: false });
      Network.sendGame({ type: "input", action: "right", down: false });
      return;
    }
    if (battle && battle.phase === "fighting" && !battle.online) pauseBattle(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && battle && battle.phase === "fighting" && !battle.online) pauseBattle(true);
  });

  document.addEventListener("pointerdown", () => AudioEngine.unlock(), { once: true });

  /* ═══════════════════════════════════════════════════════
     Pause / leave / result
     ═══════════════════════════════════════════════════════ */
  function pauseBattle(auto = false) {
    if (!battle || battle.phase !== "fighting" || battle.online) return;
    battle.phase = "paused";
    clearKeys();
    setOverlay(ui.pauseOverlay, true);
    if (!auto) AudioEngine.play("ui");
    if (auto) showToast("检测到您已离开窗口，已自动暂停", 1400);
  }

  function resumeBattle() {
    if (!battle || battle.phase !== "paused") return;
    battle.phase = "fighting";
    clearKeys();
    setOverlay(ui.pauseOverlay, false);
    lastFrame = performance.now();
    AudioEngine.play("ui");
  }

  function rematch() {
    handleRematchClick();
  }

  function returnToSelect() {
    Latency.stop();
    AudioEngine.play("ui");
    clearResultChoiceTimer();
    resultChoiceExpired = false;
    resultChoiceMode = "ai";
    if (ui.rematchTimer) ui.rematchTimer.hidden = true;
    if (online) {
      Network.close(true);
      online = null;
      resetOnlineUi("online");
    }
    setOverlay(ui.pauseOverlay, false);
    setOverlay(ui.resultOverlay, false);
    if (ui.netBadge) ui.netBadge.hidden = true;
    showSelect();
    selectCharacter(selectedId, { silent: true });
    battleShell.classList.remove("online-guest");
    ui.pauseBtn.style.display = "";
  }

  /* ═══════════════════════════════════════════════════════
     Combat helpers
     ═══════════════════════════════════════════════════════ */
  function opponentOf(fighter, battleRef) {
    return fighter === battleRef.player ? battleRef.enemy : battleRef.player;
  }

  function aimAt(fighter, opponent) {
    if (!opponent) return;
    if (Math.abs(opponent.x - fighter.x) > 2) fighter.facing = sign(opponent.x - fighter.x);
  }

  function canAct(fighter, b) {
    // 不再用 hitStop 掐掉输入：顿帧已改为局部时间缩放，输入永远能立即响应。
    // 注意：冲刺(dashTimer)不是"动作"，冲刺途中也能继续出普攻，实现"冲+打"并行。
    return b.phase === "fighting"
      && fighter.alive
      && fighter.stun <= 0
      && !fighter.action;
  }

  function tryDash(fighter, b) {
    if (b.phase !== "fighting" || !fighter.alive) return false;
    if (fighter.stun > 0 || fighter.rootTimer > 0 || fighter.hitstun > 0 || fighter.dashCd > 0) return false;
    // 冲刺与普攻是两条并行的状态：冲刺途中可以继续出普攻，已在进行的普攻也不会被打断。
    // 唯一的限制是技能"起手阶段"（还没打出判定）不能被冲刺取消，避免技能白嫖。
    if (fighter.action && fighter.action.kind === "skill" && fighter.action.t < fighter.action.impactAt) {
      return false;
    }
    let direction = fighter.facing;
    if (fighter === b.player) {
      const left = keys.has("KeyA");
      const right = keys.has("KeyD");
      if (left && !right) direction = -1;
      else if (right && !left) direction = 1;
    } else if (b.online && b.online.role === "host" && b.online.remoteControls) {
      const left = b.online.remoteControls.left;
      const right = b.online.remoteControls.right;
      if (left && !right) direction = -1;
      else if (right && !left) direction = 1;
    }
    // 普攻朝向跟着冲刺方向走，保证"冲出去的方向=出招方向"
    fighter.facing = direction;
    fighter.dashDir = direction;
    fighter.dashTimer = DASH_TIME;
    fighter.dashCd = DASH_COOLDOWN;
    // 冲刺后短暂保持冲刺朝向（与位移同向），避免动画与运动反向
    fighter.dashKeepFacing = 0.35;
    fighter.invulnTimer = Math.max(fighter.invulnTimer, DASH_INVULN);
    fighter.vx = direction * DASH_SPEED;
    // 冲刺与普攻并行：冲刺不再清空正在进行的普攻（否则会吞掉攻击判定）。
    // 只有当普攻还停在"起手阶段、尚未打出判定"时，才把判定立即提前结算，
    // 保证「冲 + 打」同拍按下时攻击必定命中，同时保留冲刺的位移。
    if (fighter.action && fighter.action.kind === "normal" && !fighter.action.impactDone) {
      fighter.action.t = Math.max(fighter.action.t, fighter.action.impactAt);
    }
    fighter.dashBuffer = 0;
    const dashSide = fighter === b.player ? "player" : "enemy";
    if (b.stats && b.stats[dashSide]) b.stats[dashSide].dashes = (b.stats[dashSide].dashes || 0) + 1;
    addBurst(b, fighter.x, fighter.y - 38, "#baf5ff", 11, 170);
    addRing(b, fighter.x, fighter.y - 42, "#9ceeff", 56, 0.28, 2);
    AudioEngine.play("dash");
    return true;
  }

  function tryNormal(fighter, b) {
    if (!canAct(fighter, b) || fighter.normalCd > 0) return false;
    const n = fighter.char.normal;
    const rapid = fighter.char.id === "claude" && fighter.rapidNormalCharges > 0;
    const attackSpeedMultiplier = fighter.attackSpeedTimer > 0 ? 1 - fighter.attackSpeedFactor : 1;
    const milkAttackSpeed = fighter.char.id === "doubao" && fighter.milkTimer > 0
      ? 1 + (fighter.char.skill.attackSpeedBonus || 0)
      : 1;
    const speedMultiplier = (rapid ? 1 + fighter.char.skill.rapidNormalSpeed : 1)
      * attackSpeedMultiplier
      * milkAttackSpeed;
    if (rapid) fighter.rapidNormalCharges -= 1;
    aimAt(fighter, opponentOf(fighter, b));
    fighter.normalCd = n.cooldown / speedMultiplier;
    fighter.action = {
      kind: "normal",
      t: 0,
      impactAt: n.windup / speedMultiplier,
      duration: n.duration / speedMultiplier,
      impactDone: false,
      rapidNormal: rapid
    };
    if (rapid) {
      addFloat(b, fighter.x, fighter.y - fighter.char.battleHeight - 24, "封号速射", "#ffd7a2", 11, 0.7);
    }
    AudioEngine.play(n.type === "melee" ? "swing" : "shot");
    return true;
  }

  function trySkill(fighter, b) {
    if (!canAct(fighter, b)) return false;
    const s = fighter.char.skill;
    if (fighter.skillCd > 0) {
      if (fighter === b.player) showToast("技能冷却中");
      return false;
    }
    if (fighter.token < s.cost) {
      if (fighter === b.player) showToast(`TOKEN 不足 · 还需 ${Math.ceil(s.cost - fighter.token)} 点`);
      return false;
    }

    const opponent = opponentOf(fighter, b);
    const attackRange = RANGED_LIMIT * (1 + (fighter.char.attackRangeBonus || 0));
    if (["rice", "scroll", "beam"].includes(s.type) && Math.abs(opponent.x - fighter.x) > attackRange) {
      if (fighter === b.player) showToast("对手超出技能射程 · 先接近再施放");
      return false;
    }

    aimAt(fighter, opponent);
    fighter.token = Math.max(0, fighter.token - s.cost);
    fighter.skillCd = s.cooldown;
    fighter.action = {
      kind: "skill",
      t: 0,
      impactAt: s.windup,
      duration: s.duration,
      impactDone: false,
      skillType: s.type
    };

    if (fighter === b.player) b.stats.player.skills += 1;
    else b.stats.enemy.skills += 1;

    if (fighter.char.id === "gpt" && s.type === "scroll") {
      fighter.rangeCharges = GPT_RANGE_CHARGES;
      fighter.lifestealTimer = s.lifestealDuration;
      fighter.lifestealRate = s.lifesteal;
      if (fighter === b.player) {
        showToast(`技能加速：下 3 次普攻射程 +60% · ${s.lifestealDuration}s 吸血 ${Math.round(s.lifesteal * 100)}%`, 1700);
      }
    }
    if (fighter.char.id === "claude" && s.type === "ban") {
      fighter.rapidNormalCharges = s.rapidNormalCharges || 3;
      if (fighter === b.player) {
        showToast("封号速射：下 3 次普攻攻速 +40%", 1400);
      }
    }

    AudioEngine.play("skill");
    addFloat(b, fighter.x, fighter.y - fighter.char.battleHeight - 30, s.name, fighter.char.color, 15, 1.0);
    addRing(b, fighter.x, fighter.y - 60, fighter.char.color, 100, 0.55, 2);

    if (s.type === "rice" || s.type === "ban" || s.type === "beam") {
      beginTelegraphedSkill(fighter, b, s);
    }
    return true;
  }

  function beginTelegraphedSkill(fighter, b, s) {
    const target = opponentOf(fighter, b);
    if (s.type === "rice") {
      const count = Math.max(1, s.bowlCount || 1);
      const spacing = s.bowlSpacing || 0;
      const halfSpread = spacing * ((count - 1) / 2);
      const centerX = clamp(
        target.x,
        ARENA.wallL + 92 + halfSpread,
        ARENA.wallR - 92 - halfSpread
      );
      const group = { hitDone: false };
      for (let i = 0; i < count; i += 1) {
        b.strikes.push({
          type: "rice",
          owner: fighter,
          x: centerX + (i - (count - 1) / 2) * spacing,
          y: target.y,
          t: 0,
          delay: s.warning,
          linger: 0.55,
          radius: s.radius,
          damage: s.damage,
          knockback: s.knockback,
          color: "#ffd97e",
          hitDone: false,
          group,
          center: i === (count - 1) / 2
        });
      }
    } else if (s.type === "ban") {
      // The verdict lands where the target stood when the skill was cast.
      const x = clamp(target.x, ARENA.minX, ARENA.maxX);
      b.strikes.push({
        type: "ban",
        owner: fighter,
        x,
        y: target.y,
        t: 0,
        delay: s.warning,
        linger: 0.65,
        radius: s.radius,
        damage: s.damage,
        knockback: s.knockback,
        stun: s.stun,
        root: s.rootDuration,
        color: "#ff9a63",
        hitDone: false
      });
    } else if (s.type === "beam") {
      const beamLength = RANGED_LIMIT * (1 + (fighter.char.attackRangeBonus || 0));
      // 技能出现在"释放瞬间对手所在的那一行"：直接取对手受击框的中心高度，
      // 不再夹到施放者高度附近（那样对手站在高台时就锁不到）。
      const hurt = hurtboxOf(target);
      const beamY = clamp(hurt.y + hurt.h / 2, ARENA.top + 40, GROUND_Y - 24);
      b.strikes.push({
        type: "beam",
        owner: fighter,
        x: fighter.x,
        originX: fighter.x,
        facing: fighter.facing,
        length: beamLength,
        y: beamY,
        t: 0,
        delay: s.warning,
        linger: 0.58,
        height: s.beamHeight,
        damage: s.damage,
        knockback: s.knockback,
        color: "#a9c0ff",
        hitDone: false
      });
    }
  }

  function updateAction(fighter, b, dt) {
    const action = fighter.action;
    if (!action) return;
    action.t += dt;

    if (!action.impactDone && action.t >= action.impactAt) {
      action.impactDone = true;
      if (action.kind === "normal") executeNormalImpact(fighter, b);
      else executeSkillImpact(fighter, b);
    }

    if (action.t >= action.duration) fighter.action = null;
  }

  function executeNormalImpact(fighter, b) {
    const n = fighter.char.normal;
    const target = opponentOf(fighter, b);
    if (!fighter.alive || !target.alive) return;

    if (n.type === "melee") {
      const passiveRange = fighter.char.id === "deepseek" && fighter.passiveNotified
        ? 1 + fighter.char.passive.rangeBonus
        : 1;
      const meleeRange = n.range * passiveRange;
      const hitbox = {
        x: fighter.facing > 0 ? fighter.x + 12 : fighter.x - meleeRange - 12,
        y: fighter.y - 168,
        w: meleeRange,
        h: 126
      };
      const hurt = hurtboxOf(target);
      if (rectOverlap(hitbox, hurt)) {
        dealDamage(b, fighter, target, n.damage, {
          canCrit: true,
          knockback: n.knockback,
          color: fighter.char.color,
          type: "normal",
          melee: true
        });
        addBurst(b, target.x, target.y - 105, fighter.char.color, 14, 270);
        addRing(b, target.x, target.y - 90, "#fff2e9", 52, 0.28, 2);
      } else {
        spawnWhiff(b, fighter);
      }
    } else {
      spawnNormalProjectile(fighter, b, target);
    }
  }

  function executeSkillImpact(fighter, b) {
    const s = fighter.char.skill;
    if (s.type === "milk") {
      activateMilkForm(fighter, b);
    } else if (s.type === "scroll") {
      const target = opponentOf(fighter, b);
      spawnScroll(fighter, b, target);
    } else if (s.type === "bubbles") {
      spawnBubbles(fighter, b);
    }
  }

  function activateMilkForm(fighter, b) {
    const s = fighter.char.skill;
    fighter.milkTimer = s.buffDuration;
    const centerY = fighter.y - 90;
    addFloat(b, fighter.x, fighter.y - fighter.char.formHeight - 34, "豆奶形态!", "#e8fbff", 22, 1.2);
    addRing(b, fighter.x, centerY, "#eafcff", 150, 0.7, 4);
    addRing(b, fighter.x, centerY, "#9beeff", 105, 0.55, 2);
    addBurst(b, fighter.x, centerY, "#f8ffff", 28, 330);
    addBurst(b, fighter.x, centerY, "#9beeff", 18, 250);
    b.shake = Math.max(b.shake, 7);
    AudioEngine.play("transform");
    if (fighter === b.player) {
      showToast(`豆奶形态 · ${s.buffDuration} 秒 · 普攻 +${Math.round(s.damageBonus * 100)}% / 攻速 +${Math.round(s.attackSpeedBonus * 100)}% / 移速 +${Math.round(s.speedBonus * 100)}% / 吸血 ${Math.round(s.lifesteal * 100)}% / 受控 -${Math.round(s.controlResist * 100)}%`, 1900);
    }
  }

  function spawnNormalProjectile(fighter, b, target) {
    const n = fighter.char.normal;
    const kind = fighter.char.id === "gpt" ? "feather" : fighter.char.id === "kimi" ? "note" : "page";
    const empowered = fighter.char.id === "gpt" && fighter.rangeCharges > 0;
    if (empowered) fighter.rangeCharges -= 1;
    const baseRange = RANGED_LIMIT * (1 + (fighter.char.attackRangeBonus || 0));
    const projectileRange = empowered ? baseRange * GPT_RANGE_MULT : baseRange;
    const originX = fighter.x + fighter.facing * 42;
    const originY = fighter.y - 112;
    let dx = target.x - originX;
    let dy = (target.y - 92) - originY;
    if (fighter.isAI) {
      // A deliberately imperfect aim: the AI canonically over-explains and misses.
      dx += rand(-b.ai.conf.aimX, b.ai.conf.aimX);
      dy += rand(-b.ai.conf.aimY, b.ai.conf.aimY);
    }
    if (Math.abs(dx) < 1) dx = fighter.facing;
    const len = Math.hypot(dx, dy) || 1;
    const rapidNormal = fighter.char.id === "claude" && !!fighter.action?.rapidNormal;
    const speed = n.projectile.speed * (rapidNormal ? 1 + fighter.char.skill.rapidNormalSpeed : 1);
    const vx = (dx / len) * speed;
    const vy = (dy / len) * speed;

    b.projectiles.push({
      type: "normal",
      kind,
      owner: fighter,
      x: originX,
      y: originY,
      originX: fighter.x,
      maxDistance: projectileRange,
      vx,
      vy,
      angle: Math.atan2(vy, vx),
      w: n.projectile.w,
      h: n.projectile.h,
      damage: n.damage,
      canCrit: true,
      // Ranged normal attacks shove less than melee blows.
      knockback: n.knockback * 0.5 * (empowered ? 1.25 : 1),
      empowered,
      color: fighter.char.color,
      life: 1.9,
      maxLife: 1.9,
      age: 0,
      gravity: 0,
      bounces: 0
    });

    if (empowered) {
      addBurst(b, originX, originY, "#e4d7ff", 9, 165);
      addFloat(b, fighter.x, fighter.y - fighter.char.battleHeight - 25, "羽刃强化", "#e5d8ff", 11, 0.7);
    }
    addBurst(b, originX, originY, fighter.char.color, 5, 95);
    AudioEngine.play("shot");
  }

  function spawnScroll(fighter, b, target) {
    const s = fighter.char.skill;
    b.projectiles.push({
      type: "skill",
      kind: "scroll",
      owner: fighter,
      x: fighter.x + fighter.facing * 118,
      y: fighter.y - 94,
      originX: fighter.x,
      maxDistance: RANGED_LIMIT,
      vx: fighter.facing * s.projectile.speed,
      vy: 0,
      angle: 0,
      w: s.projectile.w,
      h: s.projectile.h,
      damage: s.damage,
      canCrit: false,
      knockback: s.knockback,
      color: "#ded3ff",
      life: s.projectile.life,
      maxLife: s.projectile.life,
      age: 0,
      gravity: 0,
      bounces: 0
    });
    AudioEngine.play("shot");
    addBurst(b, fighter.x + fighter.facing * 90, fighter.y - 110, fighter.char.color, 14, 220);
  }

  function spawnBubbles(fighter, b) {
    const s = fighter.char.skill;
    for (let i = 0; i < s.count; i += 1) {
      b.projectiles.push({
        type: "skill",
        kind: "bubble",
        variant: i,
        owner: fighter,
        x: fighter.x + fighter.facing * (40 + i * 9),
        y: fighter.y - 150 - i * 16,
        vx: fighter.facing * (390 + i * 38),
        vy: -320 + i * 115,
        angle: 0,
        w: 58,
        h: 46,
        damage: s.damage,
        canCrit: false,
        knockback: s.knockback,
        color: "#ffd25f",
        life: 2.7,
        maxLife: 2.7,
        age: 0,
        gravity: 900,
        bounces: 2
      });
    }
    AudioEngine.play("bubble");
  }

  function rectOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function hurtboxOf(fighter) {
    const dims = getHurtSize(fighter.char);
    return { x: fighter.x - dims.w / 2, y: fighter.y - dims.h, w: dims.w, h: dims.h };
  }

  function getHurtSize(char) {
    if (char.id === "doubao") return { w: 82, h: 116 };
    if (char.id === "gpt") return { w: 60, h: 150 };
    return { w: 56, h: 144 };
  }

  function projectilesCollide(p, fighter) {
    return rectOverlap(
      { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h },
      hurtboxOf(fighter)
    );
  }

  function dealDamage(b, source, target, amount, options = {}) {
    if (!b || b.phase !== "fighting" || !target.alive) return false;

    if (target.invulnTimer > 0) {
      addFloat(b, target.x, target.y - 150, "无敌帧!", "#bdf6ff", 15, 0.7);
      addRing(b, target.x, target.y - 75, "#bdf6ff", 58, 0.3, 2);
      AudioEngine.play("dodge");
      return false;
    }

    const targetStats = target === b.player ? b.stats.player : b.stats.enemy;
    const sourceStats = source === b.player ? b.stats.player : b.stats.enemy;
    const isSkillHit = options.type === "skill";
    const dodgeChance = isSkillHit ? target.char.dodge * SKILL_DODGE_FACTOR : target.char.dodge;
    const rollDodge = Math.random() < dodgeChance;
    const dir = sign(target.x - source.x) || source.facing || 1;
    const hurtH = getHurtSize(target.char).h;
    const hitX = target.x + rand(-10, 10);
    const hitY = target.y - hurtH * 0.78 + rand(-8, 8);

    if (rollDodge) {
      target.dodgeFlash = 0.32;
      targetStats.dodges += 1;
      addFloat(b, target.x, target.y - hurtH - 24, isSkillHit ? "擦身而过!" : "闪避!", "#74edff", 20, 0.9);
      addRing(b, target.x, target.y - 74, "#74edff", 52, 0.34, 2);
      addBurst(b, target.x, target.y - 88, "#74edff", 8, 130);
      AudioEngine.play("dodge");
      if (target.char.id === "doubao") {
        const passive = target.char.passive;
        if (passive.dodgeSpeedDuration > 0) {
          target.hasteTimer = Math.max(target.hasteTimer, passive.dodgeSpeedDuration);
          target.hasteFactor = passive.dodgeSpeedBonus;
          addFloat(b, target.x, target.y - hurtH - 66, `移速 +${Math.round(passive.dodgeSpeedBonus * 100)}%`, "#9effd8", 12, 0.8);
        }
        if (target.skillCd > 0) {
          target.skillCd = Math.max(0, target.skillCd - passive.skillCdRefund);
          addFloat(b, target.x, target.y - hurtH - 68, `技能冷却 -${passive.skillCdRefund}s`, "#c9f6ff", 11, 0.8);
        }
        if (target.passiveCd <= 0) {
          target.passiveCd = passive.tokenCooldown;
          target.token = Math.min(target.char.tokenMax, target.token + passive.tokenGain);
          addFloat(b, target.x, target.y - hurtH - 46, `已读回蓝 +${passive.tokenGain}`, "#ffe6a8", 12, 0.85);
        }
      }
      return false;
    }

    let damage = amount;
    let isCrit = false;
    if (options.canCrit && Math.random() < source.char.crit) {
      isCrit = true;
      damage = Math.round(damage * CRIT_MULT);
      sourceStats.crits += 1;
    }
    const isCounterHit = source.char.counter === target.char.id;
    if (isCounterHit) damage = Math.round(damage * (1 + COUNTER_BONUS));
    const milkPower = source.milkTimer > 0 && options.type === "normal";
    if (milkPower) damage = Math.round(damage * (1 + source.char.skill.damageBonus));

    const deepseekAwake = source.char.id === "deepseek"
      && source.passiveNotified;
    if (deepseekAwake) {
      damage = Math.round(damage * (1 + source.char.passive.damageBonus));
    }

    let passiveGuard = "";
    if (target.char.id === "kimi" && target.token >= target.char.passive.tokenThreshold) {
      // 护体按伤害来源区分：近战伤害减免更高，远程伤害减免较低
      const kp = target.char.passive;
      const guardRate = options.melee ? (kp.meleeDamageReduction ?? kp.damageReduction) : kp.damageReduction;
      damage = Math.round(damage * (1 - guardRate));
      passiveGuard = options.melee ? "长文护体 · 近战" : "长文护体 · 远程";
      // 每场一次：首次进入"长文护体"状态时，额外获得一次伤害减免，
      // 该次受击再按相同比例减免一次（与护体叠加），用掉即消失。
      if (kp.firstEntryBlock && !target.entryBlockUsed) {
        target.entryBlockUsed = true;
        const extra = kp.blockReduction || kp.damageReduction;
        damage = Math.round(damage * (1 - extra));
        passiveGuard = "长文护体 · 初次减免";
        addFloat(b, target.x, target.y - 132, "护体展开", "#bff0ff", 15, 1.0);
        addRing(b, target.x, target.y - 92, "#9fe4ff", 84, 0.42, 3);
        AudioEngine.play("heal");
      }
    }

    const hpBefore = target.hp;
    target.hp = Math.max(0, target.hp - damage);
    const applied = hpBefore - target.hp;
    sourceStats.damage += applied;
    target.dashTimer = 0;

    // Claude's reviewed speed penalty is applied by his normal hits.
    if (source.char.id === "claude" && options.type === "normal" && source.passiveCd <= 0) {
      source.passiveCd = source.char.passive.cooldown;
      target.slowTimer = Math.max(target.slowTimer, source.char.passive.slowDuration);
      target.slowFactor = source.char.passive.slowFactor;
      target.attackSpeedTimer = Math.max(target.attackSpeedTimer, source.char.passive.attackSpeedDuration);
      target.attackSpeedFactor = source.char.passive.attackSpeedReduction;
      addFloat(b, target.x, hitY - 32, `移速 -${Math.round(source.char.passive.slowFactor * 100)}%`, "#ffd59a", 13, 0.85);
      addFloat(b, target.x, hitY - 50, `攻速 -${Math.round(source.char.passive.attackSpeedReduction * 100)}%`, "#ffb9ad", 12, 0.85);
      addRing(b, target.x, target.y - 62, "#ffd59a", 48, 0.3, 2);
    }

    let lifestealHeal = 0;
    let lifestealRate = 0;
    if (source.char.id === "doubao" && source.milkTimer > 0) {
      lifestealRate = source.char.skill.lifesteal || 0;
    }
    if (source.lifestealTimer > 0) {
      lifestealRate = Math.max(lifestealRate, source.lifestealRate || 0);
    }
    if (lifestealRate > 0 && applied > 0 && source.alive) {
      const beforeHeal = source.hp;
      source.hp = Math.min(source.char.hpMax, source.hp + Math.round(applied * lifestealRate));
      lifestealHeal = Math.round(source.hp - beforeHeal);
      if (lifestealHeal > 0) {
        addFloat(b, source.x, source.y - getHurtSize(source.char).h - 28, `吸血 +${lifestealHeal}`, "#9dffd1", 12, 0.8);
      }
    }

    let revived = false;
    if (target.hp <= 0 && target.char.id === "gpt" && !target.passiveUsed) {
      target.passiveUsed = true;
      target.hp = Math.max(1, Math.round(target.char.hpMax * target.char.passive.reviveRatio));
      target.skillCd = 0;
      target.token = Math.min(target.char.tokenMax, target.token + target.char.passive.tokenRefund);
      target.backlashTimer = target.char.passive.backlashDelay;
      target.action = null;
      revived = true;
      addFloat(b, target.x, target.y - hurtH - 54, `服务器重启 +${Math.round(target.char.passive.reviveRatio * 100)}% 生命`, "#d6f4ff", 14, 1.25);
      addFloat(b, target.x, target.y - hurtH - 82, `技能已刷新 · +${target.char.passive.tokenRefund} TOKEN`, "#9effd8", 12, 1.15);
      addRing(b, target.x, target.y - 82, "#d6f4ff", 90, 0.6, 3);
      addBurst(b, target.x, target.y - 92, "#eafcff", 22, 250);
      showPassiveBanner(
        target === b.player ? "服务器重启" : "对手服务器重启",
        target === b.player
          ? `SERVER REBOOT · ${Math.round(target.char.passive.reviveRatio * 100)}% 生命 / 技能刷新 / ${target.char.passive.tokenRefund} TOKEN / ${target.char.passive.backlashDelay} 秒后反噬`
          : `对方回复 ${Math.round(target.char.passive.reviveRatio * 100)}% 生命并刷新技能 · ${target.char.passive.backlashDelay} 秒后反噬`
      );
      AudioEngine.play("transform");
    }

    if (target.hp > 0 && !revived) {
      if (target.char.id === "deepseek" && !target.passiveNotified && target.hp / target.char.hpMax <= 0.45) {
        target.passiveNotified = true;
        target.invulnTimer = Math.max(target.invulnTimer, target.char.passive.invulnDuration);
        addFloat(b, target.x, target.y - hurtH - 34, "开源省流模式开启", "#b7ffdf", 13, 1.15);
        addRing(b, target.x, target.y - 82, "#b7ffdf", 82, 0.6, 3);
        showPassiveBanner(
          target === b.player ? "开源省流模式已开启" : "对手开启：开源省流",
          target === b.player ? "OPEN SOURCE MODE · 移速 / 范围 / 伤害提升" : "对方获得强化与短暂无敌"
        );
        AudioEngine.play("transform");
      }
    }

    b.hitLog.push({
      at: Number(b.elapsed.toFixed(2)),
      source: source.char.id,
      target: target.char.id,
      damage,
      applied,
      canCrit: !!options.canCrit,
      crit: isCrit,
      counter: isCounterHit,
      milkPower,
      deepseekAwake,
      passiveGuard,
      lifestealHeal,
      kind: options.type || "unknown",
      sx: Number(source.x.toFixed(1)),
      tx: Number(target.x.toFixed(1))
    });
    if (isCounterHit) {
      addFloat(b, hitX + 26, hitY - 26, "克制!", "#ffb8d8", 12, 0.8);
    }

    target.hurtFlash = 0.18;
    const controlMultiplier = target.char.id === "doubao" && target.milkTimer > 0
      ? 1 - (target.char.skill.controlResist || 0)
      : 1;
    target.hitstun = Math.max(target.hitstun, (options.stun ? 0.08 : 0.13) * controlMultiplier);
    if (options.stun) target.stun = Math.max(target.stun, options.stun * controlMultiplier);
    if (options.root) {
      target.rootTimer = Math.max(target.rootTimer, ((options.stun || 0) + options.root) * controlMultiplier);
    }
    if (controlMultiplier < 1 && (options.stun || options.root)) {
      addFloat(b, target.x, hitY - 68, "受控时间 -30%", "#bfffe2", 11, 0.8);
    }
    // 远程攻击打到近战角色时大幅减免击退，避免近战被弹道一直弹开、无法贴身。
    const meleeTarget = target.char.normal.type === "melee";
    const rangedKnockbackScale = options.ranged ? (meleeTarget ? 0.25 : 0.5) : 1;
    const effectiveKnockback = (options.knockback || 200) * rangedKnockbackScale;
    target.vx = dir * effectiveKnockback;
    if (!target.support && target.vy > -80) target.vy = Math.min(target.vy, -120);

    addFloat(
      b,
      hitX,
      hitY,
      `-${damage}`,
      isCrit ? "#ffd86e" : options.type === "skill" ? "#ffb08a" : "#ffe1e2",
      isCrit ? 44 : 32,
      isCrit ? 1.15 : 0.9
    );
    if (isCrit) {
      addFloat(b, hitX, hitY - 40, "暴击!", "#ffd86e", 20, 1.0);
    }
    addBurst(b, target.x, target.y - 110, isCrit ? "#ffd86e" : (options.color || "#ffc0c4"), isCrit ? 18 : 10, isCrit ? 300 : 210);
    addRing(b, target.x, target.y - 92, isCrit ? "#ffd86e" : (options.color || "#ff9aa3"), isCrit ? 72 : 42, 0.36, isCrit ? 3 : 2);
    if (options.melee) {
      addBurst(b, target.x, target.y - 92, isCrit ? "#ffe5a2" : "#ffffff", isCrit ? 14 : 8, isCrit ? 260 : 180);
      b.hitStop = Math.max(b.hitStop, isCrit ? 0.085 : 0.05);
      b.shake = Math.max(b.shake, isCrit ? 14 : 9);
    }
    b.shake = Math.max(b.shake, isCrit ? 11 : options.type === "skill" ? 8 : 5);
    b.hitFlash = Math.max(b.hitFlash, isCrit ? 0.09 : 0.035);
    AudioEngine.play(isCrit ? "crit" : isSkillHit ? "skillHit" : options.melee ? "meleeHit" : "hit");

    if (target.hp <= 0 && !revived) {
      target.alive = false;
      target.action = null;
      target.koTime = 0;
      target.koDirection = dir;
      target.vx = dir * Math.max(180, effectiveKnockback) * 1.35;
      target.vy = -280;
      b.winner = target === b.enemy ? "player" : "enemy";
      b.reason = "ko";
      b.phase = "ending";
      b.endingTimer = 1.65;
      clearKeys();
      AudioEngine.play("ko");
      announce("K.O.", target === b.enemy ? `${b.enemy.char.name} 被击破` : `${b.player.char.name} 被击破`, "is-ko", 1500);
      addBurst(b, target.x, target.y - 110, "#ff7c8d", 28, 380);
    }
    return true;
  }

  function applyGptBacklash(b, fighter) {
    if (!b || b.phase !== "fighting" || !fighter.alive) return;
    const passive = fighter.char.passive;
    const loss = Math.max(1, Math.round(fighter.char.hpMax * (passive.backlashRatio || 0.1)));
    const before = fighter.hp;
    fighter.hp = Math.max(0, fighter.hp - loss);
    const applied = before - fighter.hp;
    fighter.hurtFlash = 0.22;
    fighter.action = null;
    fighter.hitstun = Math.max(fighter.hitstun, 0.16);
    addFloat(b, fighter.x, fighter.y - getHurtSize(fighter.char).h - 32, `反噬 -${applied}`, "#ff9a9a", 18, 1.1);
    addBurst(b, fighter.x, fighter.y - 92, "#ff8f9f", 16, 220);
    addRing(b, fighter.x, fighter.y - 80, "#ff8f9f", 70, 0.45, 2);
    b.hitFlash = Math.max(b.hitFlash, 0.06);
    b.shake = Math.max(b.shake, 8);
    AudioEngine.play("hit");
    if (fighter === b.player) showToast(`服务器反噬 · -${applied} 生命`, 1200);

    if (fighter.hp <= 0) {
      fighter.alive = false;
      fighter.action = null;
      fighter.koTime = 0;
      fighter.koDirection = -fighter.facing || 1;
      fighter.vx = fighter.koDirection * 160;
      fighter.vy = -260;
      b.winner = fighter === b.enemy ? "player" : "enemy";
      b.reason = "ko";
      b.phase = "ending";
      b.endingTimer = 1.65;
      clearKeys();
      AudioEngine.play("ko");
      announce("K.O.", `${fighter.char.name} 被反噬击破`, "is-ko", 1500);
      addBurst(b, fighter.x, fighter.y - 110, "#ff7c8d", 24, 340);
    }
  }

  /* ═══════════════════════════════════════════════════════
     Simulation
     ═══════════════════════════════════════════════════════ */
  function updateCountdown(b, dt) {
    b.countdown -= dt;
    const n = Math.max(0, Math.ceil(b.countdown));
    if (n > 0 && n !== b.lastCountdown) {
      b.lastCountdown = n;
      announce(String(n), `${b.player.char.name}  VS  ${b.enemy.char.name}`, "is-countdown", 760);
      AudioEngine.play("count");
    }
    if (b.countdown <= 0) {
      b.countdown = 0;
      b.phase = "fighting";
      announce("开战", "FIGHT", "is-fight", 900);
      AudioEngine.play("fight");
      b.ai.decisionIn = 0.65 + Math.random() * 0.3;
      b.ai.skillLockout = b.ai.conf.initialLockout;
    }
  }

  function updateBattle(dt) {
    const b = battle;
    if (!b) return;
    b.visualTime += dt;

    // 顿帧改为局部时间缩放，不再 return 冻结整局：
    // 输入永远即时生效，连招不会被整帧重放打断，也顺手修掉了 hitFlash 在冻结期不衰减的问题。
    b.hitStop = Math.max(0, b.hitStop - dt);
    const step = b.phase === "fighting" && b.hitStop > 0 ? dt * 0.22 : dt;

    updateCosmetics(b, dt);
    b.shake = Math.max(0, b.shake - dt * 38);
    b.hitFlash = Math.max(0, b.hitFlash - dt);

    if (b.phase === "countdown") {
      updateCountdown(b, dt);
      return;
    }

    if (b.phase === "ending") {
      updateKoSequence(b, dt);
      return;
    }

    if (b.phase !== "fighting") return;

    b.elapsed += step;
    b.timeLeft = Math.max(0, b.timeLeft - step);
    if (!b.lateRegenAnnounced && b.elapsed >= TOKEN_REGEN_FALL_AT) {
      b.lateRegenAnnounced = true;
      showToast("战局进入中盘 · TOKEN 回复速度 -50%", 1600);
    }

    const playerControls = {
      left: keys.has("KeyA"),
      right: keys.has("KeyD")
    };

    updateFighter(b, b.player, b.enemy, playerControls, step);
    if (b.phase !== "fighting") return;
    if (b.online && b.online.role === "host") {
      updateFighter(b, b.enemy, b.player, b.online.remoteControls, step);
    } else {
      updateAI(b, dt);
      if (b.phase !== "fighting") return;
      updateFighter(b, b.enemy, b.player, b.ai.controls, step);
    }
    if (b.phase !== "fighting") return;

    updateProjectiles(b, step);
    if (b.phase !== "fighting") return;
    updateStrikes(b, step);
    if (b.phase !== "fighting") return;
    updatePickups(b, step);
    if (b.phase !== "fighting") return;

    if (b.timeLeft <= 0) {
      const pr = b.player.hp / b.player.char.hpMax;
      const er = b.enemy.hp / b.enemy.char.hpMax;
      b.winner = Math.abs(pr - er) < 0.001 ? "draw" : pr > er ? "player" : "enemy";
      b.reason = "time";
      b.phase = "ending";
      b.endingTimer = 1.55;
      clearKeys();
      AudioEngine.play("ko");
      announce("时间到", "TIME UP · 按剩余生命比例判定", "is-time", 1450);
    }
  }

  function updateCosmetics(b, dt) {
    b.fxTick += dt;

    for (let i = b.particles.length - 1; i >= 0; i -= 1) {
      const p = b.particles[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(0.15, dt);
      if (p.age >= p.life) b.particles.splice(i, 1);
    }

    for (let i = b.floats.length - 1; i >= 0; i -= 1) {
      const f = b.floats[i];
      f.age += dt;
      f.y += f.vy * dt;
      f.vy *= Math.pow(0.22, dt);
      if (f.age >= f.life) b.floats.splice(i, 1);
    }

    for (let i = b.rings.length - 1; i >= 0; i -= 1) {
      const r = b.rings[i];
      r.age += dt;
      if (r.age >= r.life) b.rings.splice(i, 1);
    }
  }

  function updateKoSequence(b, dt) {
    b.endingTimer -= dt;
    for (const fighter of [b.player, b.enemy]) {
      if (!fighter.alive) {
        fighter.koTime += dt;
        fighter.vy += GRAVITY * dt;
        fighter.y += fighter.vy * dt;
        fighter.x += fighter.vx * dt;
        fighter.vx *= Math.pow(0.1, dt);
        fighter.x = clamp(fighter.x, ARENA.minX, ARENA.maxX);
        if (fighter.y >= GROUND_Y) {
          fighter.y = GROUND_Y;
          fighter.vy = 0;
        }
        fighter.koRotation = clamp(fighter.koTime * 2.1, 0, 1) * 1.22;
      } else if (fighter.action) {
        updateAction(fighter, b, dt);
      }
    }
    if (b.endingTimer <= 0) finishBattle();
  }

  function updateFighter(b, fighter, opponent, controls, dt) {
    if (!fighter.alive) return;

    fighter.normalCd = Math.max(0, fighter.normalCd - dt);
    fighter.skillCd = Math.max(0, fighter.skillCd - dt);
    fighter.stun = Math.max(0, fighter.stun - dt);
    fighter.hitstun = Math.max(0, fighter.hitstun - dt);
    fighter.hurtFlash = Math.max(0, fighter.hurtFlash - dt);
    fighter.dodgeFlash = Math.max(0, fighter.dodgeFlash - dt);
    fighter.jumpBuffer = Math.max(0, fighter.jumpBuffer - dt);
    fighter.invulnTimer = Math.max(0, fighter.invulnTimer - dt);
    fighter.passiveCd = Math.max(0, fighter.passiveCd - dt);
    const hadBacklash = fighter.backlashTimer > 0;
    fighter.backlashTimer = Math.max(0, fighter.backlashTimer - dt);
    if (hadBacklash && fighter.backlashTimer <= 0) {
      applyGptBacklash(b, fighter);
      if (!fighter.alive) return;
    }
    fighter.rootTimer = Math.max(0, fighter.rootTimer - dt);
    fighter.guardTimer = Math.max(0, fighter.guardTimer - dt);
    fighter.dashCd = Math.max(0, fighter.dashCd - dt);
    // 行走帧动画时钟：只有在真正走路时推进，速度决定快慢
    const walkCfg = fighter.char.walk;
    if (walkCfg) {
      const walking = fighter.support && !fighter.action && fighter.hitstun <= 0
        && fighter.stun <= 0 && fighter.dashTimer <= 0 && Math.abs(fighter.vx) > 26;
      if (walking) {
        fighter.walkPhase = (fighter.walkPhase || 0) + dt * (walkCfg.fps || 12) * clamp(Math.abs(fighter.vx) / (fighter.char.speed || 334), 0.6, 1.6);
      } else {
        // 停下时回到第一帧，避免随机停在半空姿势
        fighter.walkPhase = 0;
      }
    }
    // 冲刺缓冲：出招期间按下的 H 会在能冲的瞬间生效，不用玩家自己掐帧。
    fighter.dashBuffer = Math.max(0, fighter.dashBuffer - dt);
    if (fighter.dashBuffer > 0 && fighter.dashCd <= 0) tryDash(fighter, b);
    const wasDashing = fighter.dashTimer > 0;
    fighter.dashTimer = Math.max(0, fighter.dashTimer - dt);
    if (wasDashing && fighter.dashTimer <= 0) fighter.vx *= 0.2;

    const hadMilkForm = fighter.milkTimer > 0;
    fighter.milkTimer = Math.max(0, fighter.milkTimer - dt);
    fighter.slowTimer = Math.max(0, fighter.slowTimer - dt);
    fighter.hasteTimer = Math.max(0, fighter.hasteTimer - dt);
    fighter.attackSpeedTimer = Math.max(0, fighter.attackSpeedTimer - dt);
    fighter.lifestealTimer = Math.max(0, fighter.lifestealTimer - dt);
    if (hadMilkForm && fighter.milkTimer <= 0) {
      addFloat(b, fighter.x, fighter.y - (fighter.char.formHeight || fighter.char.battleHeight) - 20, "变身结束", "#cfefff", 13, 0.95);
      addBurst(b, fighter.x, fighter.y - 82, "#e9fcff", 12, 180);
      if (fighter === b.player) showToast("豆奶形态结束", 900);
    }

    let tokenRegen = fighter.char.tokenRegen;
    if (b.elapsed >= TOKEN_REGEN_FALL_AT) tokenRegen *= TOKEN_REGEN_LATE_MULT;
    fighter.token = Math.min(fighter.char.tokenMax, fighter.token + tokenRegen * dt);

    updateAction(fighter, b, dt);

    if (fighter.stun > 0 || fighter.hitstun > 0) {
      // Still apply gravity and knockback.
      updatePhysics(b, fighter, 0, dt, false);
      return;
    }

    const canJump = !!fighter.support && !fighter.action && fighter.rootTimer <= 0;
    if (fighter.jumpBuffer > 0 && canJump) {
      fighter.vy = -fighter.char.jump;
      fighter.support = null;
      fighter.jumpBuffer = 0;
      fighter.vx *= 0.9;
      addBurst(b, fighter.x, fighter.y - 8, fighter.char.color, 6, 100);
      AudioEngine.play("jump");
    }

    let direction = 0;
    if (fighter.rootTimer <= 0) {
      if (!fighter.action) {
        if (controls.left) direction -= 1;
        if (controls.right) direction += 1;
      } else {
        const factor = fighter.action.kind === "skill" ? 0 : 0.3;
        if (controls.left) direction -= factor;
        if (controls.right) direction += factor;
      }
    }

    updatePhysics(b, fighter, direction, dt, true);

    if (fighter.dashTimer > 0) {
      fighter.facing = fighter.dashDir;
    } else if (direction !== 0) {
      fighter.facing = direction > 0 ? 1 : -1;
    } else if (!fighter.action && opponent && Math.abs(opponent.x - fighter.x) > 2) {
      fighter.facing = opponent.x > fighter.x ? 1 : -1;
    }
    // 冲刺动画与运动方向一致：冲刺途中或冲刺刚结束时，绝不让"面向对手"把朝向掰回去，
    // 否则会出现"人往右冲、图朝左"的错位。冲刺后短暂保持冲刺朝向直到玩家主动转向。
    if (fighter.dashKeepFacing > 0) {
      fighter.dashKeepFacing = Math.max(0, fighter.dashKeepFacing - dt);
      if (fighter.dashTimer > 0 || direction === 0) fighter.facing = fighter.dashDir;
    }
  }

  function updatePhysics(b, fighter, direction, dt, allowSteer) {
    const actionFactor = fighter.action
      ? fighter.action.kind === "skill" ? 0 : 0.3
      : 1;

    if (fighter.dashTimer > 0) {
      fighter.vx = fighter.dashDir * DASH_SPEED;
    } else if (allowSteer && fighter.stun <= 0 && fighter.hitstun <= 0) {
      const milkSpeed = fighter.milkTimer > 0 ? 1 + fighter.char.skill.speedBonus : 1;
      const passiveSpeed = fighter.char.id === "deepseek" && fighter.passiveNotified
        ? 1 + fighter.char.passive.speedBonus
        : 1;
      const slowMultiplier = fighter.slowTimer > 0 ? 1 - fighter.slowFactor : 1;
      const hasteMultiplier = fighter.hasteTimer > 0 ? 1 + fighter.hasteFactor : 1;
      const baseSpeed = fighter.char.speed * actionFactor * milkSpeed * passiveSpeed * slowMultiplier * hasteMultiplier;
      const targetVx = direction * baseSpeed;
      const responsiveness = fighter.support ? 17 : 10;
      fighter.vx += (targetVx - fighter.vx) * Math.min(1, dt * responsiveness);
    } else {
      fighter.vx *= Math.pow(0.18, dt);
    }

    fighter.x += fighter.vx * dt;
    if (fighter.x < ARENA.minX) {
      fighter.x = ARENA.minX;
      fighter.vx = 0;
    } else if (fighter.x > ARENA.maxX) {
      fighter.x = ARENA.maxX;
      fighter.vx = 0;
    }

    // Leave a platform if we walk off its edge.
    if (fighter.support === "platform" && !platformAt(fighter.x, 4)) {
      fighter.support = null;
      fighter.vy = 0;
    }

    if (!fighter.support) {
      const prevY = fighter.y;
      fighter.vy = Math.min(fighter.vy + GRAVITY * dt, 1500);
      fighter.y += fighter.vy * dt;

      if (fighter.vy >= 0) {
        const landing = PLATFORMS.find((p) => fighter.x > p.x1 - 5
          && fighter.x < p.x2 + 5
          && prevY <= p.y + 2
          && fighter.y >= p.y
          && fighter.y < GROUND_Y);
        if (landing) {
          fighter.y = landing.y;
          fighter.vy = 0;
          fighter.support = "platform";
          return;
        }
        if (fighter.y >= GROUND_Y) {
          fighter.y = GROUND_Y;
          fighter.vy = 0;
          fighter.support = "ground";
        }
      }
    } else {
      const supportPlatform = platformAt(fighter.x, 4);
      fighter.y = fighter.support === "platform" && supportPlatform ? supportPlatform.y : GROUND_Y;
      fighter.vy = 0;
    }
  }

  function updateProjectiles(b, dt) {
    for (let i = b.projectiles.length - 1; i >= 0; i -= 1) {
      const p = b.projectiles[i];
      p.age += dt;
      p.life -= dt;
      if (p.life <= 0) {
        b.projectiles.splice(i, 1);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.gravity) p.vy += p.gravity * dt;

      if (p.maxDistance && Math.abs(p.x - p.originX) >= p.maxDistance) {
        addBurst(b, p.x, p.y, p.color, 4, 70);
        b.projectiles.splice(i, 1);
        continue;
      }

      if (p.kind === "bubble") {
        if (p.y + p.h / 2 > GROUND_Y && p.vy > 0) {
          p.y = GROUND_Y - p.h / 2;
          p.vy = -Math.abs(p.vy) * 0.68;
          p.vx *= 0.9;
          p.bounces -= 1;
          if (p.bounces < 0) {
            b.projectiles.splice(i, 1);
            continue;
          }
          addBurst(b, p.x, p.y + p.h / 2, p.color, 4, 80);
        }
        const bouncePlatform = PLATFORMS.find((platform) => p.x > platform.x1
          && p.x < platform.x2
          && p.y + p.h / 2 > platform.y
          && p.vy > 0
          && p.y + p.h / 2 - p.vy * dt <= platform.y + 2);
        if (bouncePlatform) {
          p.y = bouncePlatform.y - p.h / 2;
          p.vy = -Math.abs(p.vy) * 0.65;
          p.bounces -= 1;
        }
        if (b.fxTick % 0.08 < dt) {
          addParticle(b, p.x, p.y, p.color, rand(-25, 25), rand(-25, 25), 0.35, 2.5, 0);
        }
      }

      if (p.kind === "scroll" && b.fxTick % 0.04 < dt) {
        addParticle(b, p.x - sign(p.vx) * 55, p.y + rand(-34, 34), "#d9ccff", -sign(p.vx) * rand(20, 50), rand(-15, 15), 0.5, 3, 0);
      }

      if (p.x < ARENA.wallL - 80 || p.x > ARENA.wallR + 80 || p.y < 80 || p.y > H + 80) {
        b.projectiles.splice(i, 1);
        continue;
      }

      const target = p.owner === b.player ? b.enemy : b.player;
      if (!target.alive) continue;
      if (projectilesCollide(p, target)) {
        const isSkill = p.type === "skill";
        dealDamage(b, p.owner, target, p.damage, {
          canCrit: p.canCrit,
          knockback: p.knockback,
          color: p.color,
          type: isSkill ? "skill" : "normal",
          ranged: true
        });
        addBurst(b, p.x, p.y, p.color, isSkill ? 18 : 10, isSkill ? 300 : 190);
        if (p.kind === "scroll") {
          addRing(b, p.x, p.y, p.color, 110, 0.42, 3);
          b.shake = Math.max(b.shake, 9);
        }
        b.projectiles.splice(i, 1);
      }
    }
  }

  function updateStrikes(b, dt) {
    for (let i = b.strikes.length - 1; i >= 0; i -= 1) {
      const s = b.strikes[i];
      s.t += dt;

      if (!s.hitDone && s.t >= s.delay) {
        s.hitDone = true;
        resolveStrike(b, s);
      }

      if (s.t > s.delay + s.linger) b.strikes.splice(i, 1);
    }
  }

  function spawnRicePickup(b, strike) {
    const pickupPlatform = PLATFORMS.find((p) => strike.x > p.x1
      && strike.x < p.x2
      && strike.y <= p.y + 12);
    b.pickups.push({
      owner: strike.owner,
      x: strike.x,
      y: pickupPlatform ? pickupPlatform.y : GROUND_Y,
      age: 0,
      life: 1,
      maxLife: 1,
      heal: 30,
      color: "#ffe4a0"
    });
  }

  function updatePickups(b, dt) {
    for (let i = b.pickups.length - 1; i >= 0; i -= 1) {
      const p = b.pickups[i];
      p.age += dt;
      p.life -= dt;
      if (p.life <= 0) {
        b.pickups.splice(i, 1);
        continue;
      }
      const owner = p.owner;
      if (!owner || !owner.alive) continue;
      if (Math.abs(owner.x - p.x) <= 46 && Math.abs(owner.y - p.y) <= 80) {
        const healed = Math.min(p.heal, owner.char.hpMax - owner.hp);
        owner.hp = Math.min(owner.char.hpMax, owner.hp + p.heal);
        addFloat(b, owner.x, owner.y - 148, `+${Math.round(healed)} 生命`, "#a8ffd9", 18, 0.9);
        addRing(b, owner.x, owner.y - 60, "#baffdf", 48, 0.35, 2);
        addBurst(b, p.x, p.y - 14, "#ffe9b0", 12, 130);
        AudioEngine.play("heal");
        b.pickups.splice(i, 1);
      }
    }
  }

  function resolveStrike(b, s) {
    const target = s.owner === b.player ? b.enemy : b.player;
    if (!target.alive || b.phase !== "fighting") return;

    if (s.type === "beam") {
      const hurt = hurtboxOf(target);
      const beamTop = s.y - s.height / 2;
      const beamBottom = s.y + s.height / 2;
      const beamLeft = Math.min(s.originX, s.originX + s.facing * s.length);
      const beamRight = Math.max(s.originX, s.originX + s.facing * s.length);
      const horizontalHit = target.x >= beamLeft && target.x <= beamRight;
      if (horizontalHit && hurt.y < beamBottom && hurt.y + hurt.h > beamTop) {
        dealDamage(b, s.owner, target, s.damage, {
          canCrit: false,
          knockback: s.knockback,
          color: s.color,
          type: "skill",
          ranged: true
        });
      }
      addBurst(b, target.x, clamp(s.y, GROUND_Y - 220, GROUND_Y - 20), s.color, 20, 300);
      const beamCenter = (beamLeft + beamRight) / 2;
      addRing(b, beamCenter, s.y, s.color, 160, 0.55, 3);
      b.shake = Math.max(b.shake, 12);
      addFloat(b, beamCenter, s.y - 75, "上下文命中", "#d5e1ff", 14, 1.0);
      AudioEngine.play("beam");
      return;
    }

    const dx = Math.abs(target.x - s.x);
    const dy = Math.abs(target.y - s.y);
    const hit = dx <= s.radius && dy <= 188;
    const blockedByGroup = !!(s.group && s.group.hitDone);
    const impactY = s.type === "rice" ? s.y - 55 : s.y - 20;

    if (hit && !blockedByGroup) {
      const hitApplied = dealDamage(b, s.owner, target, s.damage, {
        canCrit: false,
        knockback: s.knockback,
        stun: s.stun || 0,
        root: s.root || 0,
        color: s.color,
        type: "skill",
        ranged: true
      });
      if (s.group) s.group.hitDone = true;
      if (s.type === "rice" && !hitApplied) {
        spawnRicePickup(b, s);
      }
    } else if (s.type === "rice") {
      spawnRicePickup(b, s);
    }

    if (s.type === "rice") {
      addBurst(b, s.x, impactY, "#ffe8ac", 28, 340);
      addBurst(b, s.x, impactY, "#f4f0dd", 16, 230);
      addRing(b, s.x, impactY, "#ffdd8b", 160, 0.55, 4);
      if (s.center) {
        addFloat(b, s.x, impactY - 40, "管饱!", "#ffdd8b", 22, 1.05);
        AudioEngine.play("rice");
        b.shake = Math.max(b.shake, 14);
      }
    } else {
      addBurst(b, s.x, impactY, "#ffb27c", 24, 330);
      addBurst(b, s.x, impactY, "#ff7a62", 14, 250);
      addRing(b, s.x, impactY, "#ff9a63", 178, 0.6, 4);
      addFloat(b, s.x, impactY - 34, "账号已封禁", "#ffad7d", 20, 1.1);
      AudioEngine.play("slam");
      b.shake = Math.max(b.shake, 14);
    }
  }

  /* ═══════════════════════════════════════════════════════
     AI — deliberately slow and imperfect
     ═══════════════════════════════════════════════════════ */
  function updateAI(b, dt) {
    const ai = b.ai;
    const conf = ai.conf;
    const me = b.enemy;
    const foe = b.player;
    if (!me.alive || !foe.alive) return;

    ai.skillLockout = Math.max(0, ai.skillLockout - dt);
    ai.decisionIn -= dt;

    // 冲刺按帧判定（不受决策节拍限制）：CD 一好就立刻找机会用。
    // 近战冲进去贴脸，远程看到弹道/施法就拉开，是"冲刺当基本操作"的 AI 侧实现。
    if (me.dashCd <= 0 && me.stun <= 0 && me.hitstun <= 0 && me.rootTimer <= 0) {
      const dxD = foe.x - me.x;
      const distD = Math.abs(dxD);
      const towardD = sign(dxD) || 1;
      const prefD = me.char.aiRange;
      const isMeleeD = me.char.normal.type === "melee";
      const dangerD = b.projectiles.some((p) => {
        if (p.owner === me) return false;
        const headedAtMe = sign(p.vx) === sign(me.x - p.x);
        return headedAtMe && Math.abs(p.x - me.x) < 320;
      }) || b.strikes.some((s) => s.type === "beam" && s.owner !== me && !s.hitDone);
      const foeCastingD = !!foe.action && foe.action.kind === "skill";
      let dashDirD = 0;
      if (dangerD || foeCastingD) {
        dashDirD = -towardD;
      } else if (isMeleeD && distD > prefD + 20) {
        dashDirD = towardD;
      } else if (!isMeleeD && distD < prefD - 80) {
        dashDirD = -towardD;
      }
      if (dashDirD !== 0 && Math.random() < 0.9) {
        me.facing = dashDirD;
        tryDash(me, b);
      }
    }

    // 普攻同样按帧判定：射程内且 CD 好了就立刻出，不再等决策拍。
    if (me.normalCd <= 0 && !me.action && me.stun <= 0) {
      const dxA = foe.x - me.x;
      const distA = Math.abs(dxA);
      const nA = me.char.normal;
      const rangeA = nA.type === "melee"
        ? nA.range + 28
        : RANGED_LIMIT * (1 + (me.char.attackRangeBonus || 0)) - 10;
      const chanceA = nA.type === "melee" ? ai.conf.attackMelee : ai.conf.attackRanged;
      if (distA < rangeA && Math.random() < chanceA * 0.5) {
        aimAt(me, foe);
        tryNormal(me, b);
      }
    }

    if (ai.decisionIn > 0) return;

    ai.decisionIn = rand(conf.decisionMin, conf.decisionMax);
    ai.controls.left = false;
    ai.controls.right = false;

    const dx = foe.x - me.x;
    const dist = Math.abs(dx);
    const toward = sign(dx) || 1;
    const pref = me.char.aiRange;

    // A limited, human-ish reaction to obvious projectiles.
    const dangerProjectile = b.projectiles.some((p) => {
      if (p.owner === me) return false;
      const headedAtMe = sign(p.vx) === sign(me.x - p.x);
      return headedAtMe && Math.abs(p.x - me.x) < 250 && Math.abs(p.y - (me.y - 80)) < 130;
    });
    const dangerBeam = b.strikes.some((s) => s.type === "beam" && s.owner !== me && !s.hitDone && s.t < s.delay - 0.1);

    if ((dangerProjectile || dangerBeam) && me.support && Math.random() < conf.dodgeChance) {
      me.jumpBuffer = 0.13;
    }

    if (foe.y < me.y - 60 && dist < 260 && me.support && Math.random() < conf.jumpAbove) {
      me.jumpBuffer = 0.13;
    }

    let move = 0;
    if (dist > pref + 50) {
      move = toward;
    } else if (dist < pref - 65) {
      move = -toward;
    } else if (Math.random() < 0.2) {
      move = Math.random() < 0.5 ? -1 : 1;
      ai.strafe = move;
    } else {
      ai.strafe = ai.strafe || 1;
    }

    // Stay away from the hard boundary most of the time.
    if (me.x < ARENA.minX + 50 && move < 0) move = 1;
    if (me.x > ARENA.maxX - 50 && move > 0) move = -1;

    if (move < 0) ai.controls.left = true;
    else if (move > 0) ai.controls.right = true;

    // Occasional hesitation makes lower difficulties feel less than perfect.
    const hesitation = ai.difficulty === "hard" ? 0.02 : ai.difficulty === "normal" ? 0.045 : 0.075;
    if (Math.random() < hesitation) {
      ai.controls.left = false;
      ai.controls.right = false;
      return;
    }

    const normal = me.char.normal;
    if (me.normalCd <= 0 && !me.action && me.stun <= 0) {
      const normalRange = normal.type === "melee"
        ? normal.range + 28
        : RANGED_LIMIT * (1 + (me.char.attackRangeBonus || 0)) - 10;
      const inNormalRange = dist < normalRange;
      const attackChance = normal.type === "melee" ? conf.attackMelee : conf.attackRanged;
      if (inNormalRange && Math.random() < attackChance) {
        tryNormal(me, b);
      }
    }

    if (me.skillCd <= 0 && !me.action && me.stun <= 0 && me.token >= me.char.skill.cost && ai.skillLockout <= 0) {
      const skill = me.char.skill;
      const skillRange = RANGED_LIMIT * (1 + (me.char.attackRangeBonus || 0));
      let inSkillRange = false;
      if (skill.type === "rice") inSkillRange = dist < 560;
      else if (skill.type === "scroll") inSkillRange = dist > 90 && dist < skillRange;
      else if (skill.type === "beam") inSkillRange = dist > 80 && dist < skillRange;
      else if (skill.type === "ban") inSkillRange = dist < 260;
      else if (skill.type === "milk") inSkillRange = dist < 620 && me.milkTimer <= 0;
      else if (skill.type === "bubbles") inSkillRange = dist < 660;

      if (inSkillRange && Math.random() < conf.skillChance) {
        if (trySkill(me, b)) ai.skillLockout = rand(conf.skillLockoutMin, conf.skillLockoutMax);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════
     FX helpers
     ═══════════════════════════════════════════════════════ */
  function addParticle(b, x, y, color, vx, vy, life = 0.5, size = 3, gravity = 500, shape = "circle") {
    if (b.particles.length > 260) return;
    b.particles.push({
      x, y, vx, vy, life, age: 0, size, color, gravity, shape
    });
  }

  function addBurst(b, x, y, color, count, power) {
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(power * 0.22, power);
      addParticle(
        b, x, y, color,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - rand(20, 110),
        rand(0.25, 0.65),
        rand(1.4, 4.2),
        rand(280, 850),
        Math.random() < 0.28 ? "line" : "circle"
      );
    }
  }

  function addFloat(b, x, y, text, color, size = 18, life = 0.8) {
    b.floats.push({
      x, y, text, color, size, life, age: 0, vy: -38
    });
  }

  function addRing(b, x, y, color, maxRadius, life, width) {
    b.rings.push({ x, y, color, maxRadius, life, age: 0, width });
  }

  function spawnWhiff(b, fighter) {
    addBurst(b, fighter.x + fighter.facing * 75, fighter.y - 100, "rgba(204, 232, 255, .7)", 4, 100);
  }

  /* ═══════════════════════════════════════════════════════
     Rendering
     ═══════════════════════════════════════════════════════ */
  const STARS = Array.from({ length: 68 }, () => ({
    x: Math.random() * W,
    y: 55 + Math.random() * 390,
    r: rand(0.5, 1.8),
    a: rand(0.12, 0.5),
    phase: rand(0, Math.PI * 2)
  }));

  const DUST = Array.from({ length: 30 }, () => ({
    x: Math.random() * W,
    y: 180 + Math.random() * 430,
    r: rand(0.6, 2.2),
    speed: rand(3, 12),
    phase: rand(0, Math.PI * 2)
  }));

  const BG_TOWERS = Array.from({ length: 15 }, (_, i) => {
    const x = 70 + i * 82 + rand(-15, 15);
    const h = rand(46, 190);
    return { x, y: 608 - h, w: rand(18, 54), h, a: rand(0.035, 0.11) };
  });

  function renderBattle() {
    if (!battle) return;
    const b = battle;
    const time = b.visualTime;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (b.shake > 0.2) {
      ctx.translate(rand(-b.shake, b.shake), rand(-b.shake, b.shake));
    }

    drawBackground(b, time);
    drawArena(b, time);
    drawShadows(b);
    drawStrikeTelegraphs(b, time);
    drawRicePickups(b, time);

    const drawOrder = [b.enemy, b.player].sort((a, c) => {
      if (a.y === c.y) return a.isAI ? -1 : 1;
      return a.y - c.y;
    });
    for (const fighter of drawOrder) drawFighter(b, fighter, time);

    drawNormalActionFx(b, time);
    drawStrikes(b, time);
    drawProjectiles(b, time);
    drawParticles(b);
    drawRings(b);
    drawFloats(b);
    drawForeground(b, time);

    if (b.hitFlash > 0) {
      ctx.fillStyle = `rgba(255, 238, 205, ${b.hitFlash * 2.4})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawHudArenaText(b, time);
    ctx.restore();

    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.24, W / 2, H / 2, W * 0.65);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(1,4,8,.32)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBackground(b, time) {
    // 女仆咖啡厅地图：整张 AI 背景铺满画面。平台与地面都画在背景里，
    // 碰撞盒（PLATFORMS / GROUND_Y）按背景实际像素对齐，所以背景加载成功就不再画旧的地铁背景。
    if (stageLoaded) {
      ctx.drawImage(stageImage, 0, 0, W, H);
      // 轻微呼吸的霓虹氛围光，让地图活起来（不遮挡角色）
      const pulse = 0.5 + Math.sin(time * 0.8) * 0.5;
      const sheen = ctx.createRadialGradient(W * 0.5, 300, 40, W * 0.5, 300, 520);
      sheen.addColorStop(0, `rgba(255, 170, 220, ${0.03 + pulse * 0.03})`);
      sheen.addColorStop(0.5, `rgba(120, 220, 255, ${0.015 + pulse * 0.02})`);
      sheen.addColorStop(1, "rgba(120, 220, 255, 0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, W, H);
      // 四角轻微暗角，把视线压回战斗区
      const vignette = ctx.createRadialGradient(W / 2, H / 2, 320, W / 2, H / 2, 760);
      vignette.addColorStop(0, "rgba(10, 6, 22, 0)");
      vignette.addColorStop(1, "rgba(10, 6, 22, .34)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, "#071424");
    sky.addColorStop(0.45, "#08111d");
    sky.addColorStop(1, "#0a1220");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, GROUND_Y);

    const glow = ctx.createRadialGradient(W * 0.5, 310, 10, W * 0.5, 310, 470);
    glow.addColorStop(0, "rgba(62, 143, 218, .19)");
    glow.addColorStop(0.45, "rgba(33, 82, 145, .08)");
    glow.addColorStop(1, "rgba(8, 15, 26, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, GROUND_Y);

    // far-off server monoliths
    for (const t of BG_TOWERS) {
      const grad = ctx.createLinearGradient(0, t.y, 0, t.y + t.h);
      grad.addColorStop(0, `rgba(107, 170, 225, ${t.a})`);
      grad.addColorStop(1, "rgba(66, 126, 180, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.fillStyle = "rgba(111, 219, 255, .14)";
      ctx.fillRect(t.x + t.w * 0.28, t.y + 12, 1, t.h * 0.5);
      ctx.fillRect(t.x + t.w * 0.65, t.y + 23, 1, t.h * 0.35);
    }

    // star field
    for (const s of STARS) {
      const twinkle = 0.55 + Math.sin(time * 0.65 + s.phase) * 0.35;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(174, 225, 255, ${s.a * twinkle})`;
      ctx.fill();
    }

    // moon / target ring behind the arena
    ctx.save();
    ctx.translate(W / 2, 280);
    ctx.strokeStyle = "rgba(109, 186, 255, .08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 192, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 138, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(207, 238, 255, .18)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 12]);
    ctx.beginPath();
    ctx.arc(0, 0, 97, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(137, 211, 255, .06)";
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(154, 219, 255, .14)";
    ctx.beginPath();
    ctx.arc(0, 0, 64, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // horizon haze
    const haze = ctx.createLinearGradient(0, 520, 0, 612);
    haze.addColorStop(0, "rgba(42, 113, 166, 0)");
    haze.addColorStop(0.6, "rgba(65, 156, 209, .055)");
    haze.addColorStop(1, "rgba(85, 202, 255, .1)");
    ctx.fillStyle = haze;
    ctx.fillRect(ARENA.wallL, 520, ARENA.wallR - ARENA.wallL, 92);

    // drifting data dust
    for (const d of DUST) {
      const x = d.x + Math.sin(time * 0.13 + d.phase) * 30;
      const y = d.y + Math.cos(time * 0.18 + d.phase) * 14;
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180, 231, 255, ${0.08 + 0.05 * Math.sin(time + d.phase)})`;
      ctx.fill();
    }

    // arena back glyphs
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = "#72dfff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(78, 172);
    ctx.lineTo(186, 172);
    ctx.lineTo(210, 196);
    ctx.lineTo(210, 262);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W - 78, 172);
    ctx.lineTo(W - 186, 172);
    ctx.lineTo(W - 210, 196);
    ctx.lineTo(W - 210, 262);
    ctx.stroke();
    ctx.fillStyle = "rgba(100, 206, 255, .4)";
    ctx.font = `600 7px ${DISPLAY}`;
    ctx.letterSpacing = "2px";
    ctx.fillText("ARENA / 01", 82, 160);
    ctx.fillText("NO OUTSIDE", W - 172, 160);
    ctx.restore();
  }

  function drawArena(b, time) {
    // floor body（使用 AI 地图时地面已经画在背景里，这里只补一层淡渐变过渡）
    if (stageLoaded) {
      const shade = ctx.createLinearGradient(0, GROUND_Y - 6, 0, H);
      shade.addColorStop(0, "rgba(8, 4, 18, 0)");
      shade.addColorStop(1, "rgba(8, 4, 18, .45)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, GROUND_Y - 6, W, H - GROUND_Y + 6);
      ctx.strokeStyle = "rgba(190, 240, 255, .35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ARENA.wallL, GROUND_Y);
      ctx.lineTo(ARENA.wallR, GROUND_Y);
      ctx.stroke();
    } else {
    const floorGrad = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    floorGrad.addColorStop(0, "#0a1523");
    floorGrad.addColorStop(0.45, "#08111c");
    floorGrad.addColorStop(1, "#050a10");
    ctx.fillStyle = floorGrad;
    ctx.fillRect(ARENA.wallL, GROUND_Y, ARENA.wallR - ARENA.wallL, H - GROUND_Y);

    // perspective floor lines
    ctx.save();
    ctx.beginPath();
    ctx.rect(ARENA.wallL, GROUND_Y, ARENA.wallR - ARENA.wallL, H - GROUND_Y);
    ctx.clip();
    ctx.strokeStyle = "rgba(112, 190, 255, .09)";
    ctx.lineWidth = 1;
    const horizonX = W / 2;
    for (let i = -8; i <= 8; i += 1) {
      ctx.beginPath();
      ctx.moveTo(horizonX, GROUND_Y);
      ctx.lineTo(horizonX + i * 138, H + 40);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i += 1) {
      const t = i / 5;
      const y = GROUND_Y + Math.pow(t, 1.45) * 160;
      ctx.globalAlpha = 0.35 + t * 0.4;
      ctx.beginPath();
      ctx.moveTo(ARENA.wallL, y);
      ctx.lineTo(ARENA.wallR, y);
      ctx.stroke();
    }
    ctx.restore();
    }

    // boundary walls
    for (const side of ["left", "right"]) {
      const x = side === "left" ? ARENA.wallL : ARENA.wallR;
      const grad = ctx.createLinearGradient(x, 210, x, GROUND_Y);
      grad.addColorStop(0, "rgba(93, 202, 255, 0)");
      grad.addColorStop(0.35, "rgba(93, 202, 255, .22)");
      grad.addColorStop(1, "rgba(112, 228, 255, .52)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, 176);
      ctx.lineTo(x, GROUND_Y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(106, 201, 255, .12)";
      for (let y = 226; y < GROUND_Y; y += 27) {
        const len = side === "left" ? 15 : -15;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(side === "left" ? x + 13 : x - 13, 445);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "rgba(117, 194, 237, .35)";
      ctx.font = `600 7px ${DISPLAY}`;
      ctx.letterSpacing = "2px";
      ctx.textAlign = side === "left" ? "left" : "right";
      ctx.fillText("BOUNDARY // 边界", 0, 0);
      ctx.restore();
    }

    // ground line + soft glow
    ctx.save();
    ctx.shadowColor = "rgba(87, 221, 255, .45)";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = "rgba(133, 235, 255, .7)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ARENA.wallL, GROUND_Y);
    ctx.lineTo(ARENA.wallR, GROUND_Y);
    ctx.stroke();
    ctx.restore();

    // central short platform and its two side wings
    for (const platform of PLATFORMS) {
      if (stageLoaded) drawStagePlatformEdge(time, platform);
      else drawPlatform(time, platform, platform === PLATFORM ? "中央短平台" : "上层侧翼 · 60%");
    }

    // stage markers
    ctx.fillStyle = "rgba(125, 191, 231, .32)";
    ctx.font = `600 7px ${DISPLAY}`;
    ctx.letterSpacing = "1.5px";
    ctx.fillText("GROUND // ∞", ARENA.wallL + 18, GROUND_Y + 22);
    ctx.textAlign = "right";
    ctx.fillText("STEP-Y // 132", ARENA.wallR - 18, PLATFORM.y + 28);
    ctx.textAlign = "left";

    // center line accent
    ctx.strokeStyle = "rgba(95, 177, 226, .1)";
    ctx.setLineDash([3, 11]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 184);
    ctx.lineTo(W / 2, GROUND_Y - 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // foreground corner brackets
    ctx.strokeStyle = "rgba(118, 205, 255, .25)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(42, H - 70); ctx.lineTo(42, H - 30); ctx.lineTo(94, H - 30);
    ctx.moveTo(W - 42, H - 70); ctx.lineTo(W - 42, H - 30); ctx.lineTo(W - 94, H - 30);
    ctx.stroke();
  }

  function drawPlatform(time, platform = PLATFORM, label = "SHORT PLATFORM") {
    const { x1, x2, y, h } = platform;
    const width = x2 - x1;

    // aura
    const aura = ctx.createLinearGradient(0, y, 0, y + 70);
    aura.addColorStop(0, "rgba(96, 218, 255, .11)");
    aura.addColorStop(1, "rgba(96, 218, 255, 0)");
    ctx.fillStyle = aura;
    ctx.fillRect(x1, y, width, 70);

    const body = ctx.createLinearGradient(0, y, 0, y + h);
    body.addColorStop(0, "rgba(47, 109, 146, .9)");
    body.addColorStop(1, "rgba(13, 37, 55, .94)");
    ctx.fillStyle = body;
    ctx.fillRect(x1, y, width, h);

    ctx.save();
    ctx.shadowColor = "rgba(91, 222, 255, .5)";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "rgba(143, 242, 255, .82)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "rgba(96, 206, 255, .24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y + h);
    ctx.lineTo(x2, y + h);
    ctx.stroke();

    // cap decorations
    for (let i = 0; i < 9; i += 1) {
      const x = x1 + 18 + i * (width - 36) / 8;
      ctx.fillStyle = i % 2 === 0 ? "rgba(130, 225, 255, .35)" : "rgba(130, 225, 255, .13)";
      ctx.fillRect(x, y + 4, 1, 4);
    }

    // projected feet
    ctx.strokeStyle = "rgba(73, 177, 230, .14)";
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(x1 + 20, y + h);
    ctx.lineTo(x1 + 6, GROUND_Y);
    ctx.moveTo(x2 - 20, y + h);
    ctx.lineTo(x2 - 6, GROUND_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(138, 211, 244, .35)";
    ctx.font = `600 7px ${DISPLAY}`;
    ctx.letterSpacing = "1.8px";
    ctx.textAlign = "center";
    ctx.fillText(label, (x1 + x2) / 2, y - 12);
    ctx.textAlign = "left";

    // scanning glint
    const glintX = x1 + ((time * 52) % (width + 80)) - 40;
    const glint = ctx.createLinearGradient(glintX - 40, 0, glintX + 40, 0);
    glint.addColorStop(0, "rgba(171, 247, 255, 0)");
    glint.addColorStop(0.5, "rgba(171, 247, 255, .18)");
    glint.addColorStop(1, "rgba(171, 247, 255, 0)");
    ctx.fillStyle = glint;
    ctx.fillRect(x1, y + 1, width, 2);
  }

  /* AI 地图上的平台：背景已经画好发光的奶白长条，
     这里只沿碰撞盒顶边描一圈霓虹光，让"可站立面"在画面上清清楚楚。 */
  function drawStagePlatformEdge(time, platform) {
    const { x1, x2, y } = platform;
    const width = x2 - x1;
    const pulse = 0.55 + Math.sin(time * 2.2 + x1 * 0.01) * 0.45;

    // 顶边光带
    ctx.save();
    ctx.shadowColor = "rgba(150, 235, 255, .75)";
    ctx.shadowBlur = 12;
    ctx.strokeStyle = `rgba(210, 248, 255, ${0.55 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1 + 6, y);
    ctx.lineTo(x2 - 6, y);
    ctx.stroke();
    ctx.restore();

    // 两端圆角收口
    ctx.strokeStyle = `rgba(255, 190, 230, ${0.4 + pulse * 0.3})`;
    ctx.lineWidth = 1.4;
    for (const [cx, dir] of [[x1 + 6, -1], [x2 - 6, 1]]) {
      ctx.beginPath();
      ctx.arc(cx, y + 1, 7, dir < 0 ? Math.PI * 0.5 : Math.PI * 1.5, dir < 0 ? Math.PI * 1.5 : Math.PI * 0.5);
      ctx.stroke();
    }

    // 沿边流动的扫描光点
    const t = ((time * 90) % (width + 60)) - 30;
    const gx = x1 + t;
    if (gx > x1 && gx < x2) {
      const glint = ctx.createLinearGradient(gx - 30, 0, gx + 30, 0);
      glint.addColorStop(0, "rgba(180, 245, 255, 0)");
      glint.addColorStop(0.5, "rgba(180, 245, 255, .55)");
      glint.addColorStop(1, "rgba(180, 245, 255, 0)");
      ctx.fillStyle = glint;
      ctx.fillRect(gx - 30, y - 1, 60, 3);
    }
  }

  function drawShadows(b) {
    for (const fighter of [b.enemy, b.player]) {
      const shadowPlatform = platformAt(fighter.x, 0);
      const surfaceY = shadowPlatform && fighter.y <= shadowPlatform.y + 2
        ? shadowPlatform.y
        : GROUND_Y;
      const height = Math.max(0, surfaceY - fighter.y);
      const scale = clamp(1 - height / 500, 0.34, 1);
      const bodyScale = fighter.char.battleHeight / 280;
      ctx.save();
      ctx.globalAlpha = 0.28 * scale;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(fighter.x, surfaceY + 4, 62 * scale * bodyScale, 13 * scale * bodyScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawRicePickups(b, time) {
    for (const pickup of b.pickups) {
      const remain = clamp(pickup.life / pickup.maxLife, 0, 1);
      const blink = remain < 0.28 ? 0.45 + Math.sin(time * 35) * 0.35 : 1;
      const bob = Math.sin(time * 8 + pickup.x * 0.02) * 2;
      ctx.save();
      ctx.translate(pickup.x, pickup.y + bob);
      ctx.globalAlpha = blink;

      const glow = ctx.createRadialGradient(0, -10, 2, 0, -10, 46);
      glow.addColorStop(0, "rgba(255, 235, 167, .35)");
      glow.addColorStop(1, "rgba(255, 235, 167, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, -10, 46, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255, 230, 158, .7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 2, 33, 8, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.scale(0.44, 0.44);
      drawRiceBowl(0, -6, 1, 0.82);
      ctx.restore();

      ctx.strokeStyle = "rgba(255, 238, 185, .8)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 2, 38, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain);
      ctx.stroke();

      ctx.fillStyle = "rgba(184, 255, 217, .95)";
      ctx.font = `800 10px ${DISPLAY}`;
      ctx.textAlign = "center";
      ctx.fillText("+30", 0, -30);
      ctx.restore();
    }
  }

  function drawSpriteImage(img, x, y, height, flip, alpha, rotation, filter) {
    if (!img || !img.complete || !img.naturalWidth) {
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = alpha;
      ctx.rotate(rotation);
      ctx.fillStyle = "rgba(121, 196, 255, .2)";
      ctx.strokeStyle = "rgba(157, 225, 255, .5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-52, -height, 104, height, 30);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
    const w = (img.naturalWidth / img.naturalHeight) * height;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    if (flip < 0) ctx.scale(-1, 1);
    ctx.globalAlpha = alpha;
    if (filter) ctx.filter = filter;
    ctx.drawImage(img, -w / 2, -height, w, height);
    ctx.restore();
  }

  function getFighterVisual(fighter) {
    const inMilkForm = fighter.milkTimer > 0 && !!fighter.char.formImage;
    return {
      inMilkForm,
      img: imageCache[inMilkForm ? `${fighter.char.id}-form` : fighter.char.id],
      height: inMilkForm && fighter.char.formHeight ? fighter.char.formHeight : fighter.char.battleHeight
    };
  }

  /* 行走帧精灵图：移动中、在地面上、未出招、未受击时启用。
     左右各一张条带图，按移动方向选图、按时间取帧。 */
  function getWalkSheet(fighter, moving, isKo) {
    const cfg = fighter.char.walk;
    if (!cfg || isKo || fighter.action || fighter.hitstun > 0 || fighter.stun > 0) return null;
    if (!moving || !fighter.support) return null;
    if (fighter.dashTimer > 0) return null;
    const dir = fighter.vx > 0 ? "right" : fighter.vx < 0 ? "left" : null;
    if (!dir) return null;
    const img = imageCache[`${fighter.char.id}-walk-${dir}`];
    if (!img || !img.complete || !img.naturalWidth) return null;
    const fps = cfg.fps || 12;
    // walkPhase 由 updateFighter 按移动速度累加（单位：帧）
    const index = Math.floor(fighter.walkPhase || 0) % cfg.frames;
    return { img, index, cell: cfg.cell || 160, heightRatio: cfg.heightRatio || 0.92 };
  }

  function drawFighter(b, fighter, time) {
    const char = fighter.char;
    const visual = getFighterVisual(fighter);
    const img = visual.img;
    const spriteHeight = visual.height;
    const isKo = !fighter.alive;
    const onPlatform = fighter.support === "platform";
    const moving = Math.abs(fighter.vx) > 26;
    const action = fighter.action;

    let bob = Math.sin(time * 2.1 + fighter.idleSeed) * 2.2;
    if (moving) bob += Math.sin(time * 12 + fighter.idleSeed) * 1.2;

    let lunge = 0;
    let rotation = 0;
    let scale = 1;
    if (action) {
      const p = clamp(action.t / Math.max(action.duration, 0.01), 0, 1);
      if (action.kind === "normal") {
        if (char.normal.type === "melee") lunge = fighter.facing * Math.sin(p * Math.PI) * 24;
        else lunge = -fighter.facing * Math.sin(p * Math.PI) * 7;
        rotation = fighter.facing * Math.sin(p * Math.PI) * 0.028;
        scale = 1 + Math.sin(p * Math.PI) * 0.012;
      } else {
        bob += Math.sin(p * Math.PI) * -6;
        lunge = -fighter.facing * Math.sin(p * Math.PI) * 4;
        scale = 1 + Math.sin(p * Math.PI) * 0.018;
      }
    }
    if (!fighter.support && !isKo) {
      rotation += clamp(fighter.vy / 1100, -0.12, 0.12) + fighter.facing * 0.02;
    }
    if (isKo) {
      rotation = fighter.koDirection * fighter.koRotation;
      bob = 0;
    }
    if (fighter.hurtFlash > 0) {
      lunge += rand(-3, 3);
      rotation += rand(-0.012, 0.012);
    }

    ctx.save();
    ctx.translate(fighter.x + lunge, fighter.y + bob);
    if (!isKo) ctx.scale(scale, scale);

    // character aura / skill wind-up
    if (action && action.kind === "skill" && !isKo) {
      const p = clamp(action.t / Math.max(action.duration, 0.01), 0, 1);
      const radius = 82 + Math.sin(time * 8) * 8 + p * 35;
      const aura = ctx.createRadialGradient(0, -95, 10, 0, -95, radius);
      aura.addColorStop(0, `rgba(${char.accentRgb}, .18)`);
      aura.addColorStop(0.55, `rgba(${char.accentRgb}, .05)`);
      aura.addColorStop(1, `rgba(${char.accentRgb}, 0)`);
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, -95, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${char.accentRgb}, ${0.18 + p * 0.28})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, -90, 72 + p * 28, time * 1.6, time * 1.6 + Math.PI * 1.5);
      ctx.stroke();
    }

    if (fighter.stun > 0 && !isKo) {
      ctx.strokeStyle = `rgba(${char.accentRgb}, .32)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, -177, 26 + Math.sin(time * 5) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // brief invulnerability bubble after a dash
    if (fighter.invulnTimer > 0 && !isKo) {
      const remain = clamp(fighter.invulnTimer / DASH_INVULN, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.28 + remain * 0.3;
      ctx.strokeStyle = "rgba(190, 248, 255, .9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -time * 80;
      ctx.beginPath();
      ctx.ellipse(0, -spriteHeight * 0.48, 58, spriteHeight * 0.58, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const shield = ctx.createRadialGradient(0, -spriteHeight * 0.48, 10, 0, -spriteHeight * 0.48, 78);
      shield.addColorStop(0, "rgba(197, 250, 255, .05)");
      shield.addColorStop(0.7, "rgba(130, 239, 255, .1)");
      shield.addColorStop(1, "rgba(130, 239, 255, 0)");
      ctx.fillStyle = shield;
      ctx.beginPath();
      ctx.arc(0, -spriteHeight * 0.48, 78, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Claude's follow-up root: can attack, cannot move or dash.
    if (fighter.rootTimer > 0 && fighter.stun <= 0 && !isKo) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "rgba(255, 191, 126, .8)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -time * 32;
      ctx.beginPath();
      ctx.ellipse(0, 4, 48, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 203, 144, .5)";
      for (let i = 0; i < 3; i += 1) {
        const a = time * 2 + i * 2.1;
        ctx.fillRect(Math.cos(a) * 42 - 1.5, 4 + Math.sin(a) * 9, 3, 1.5);
      }
      ctx.restore();
    }

    // GPT's post-reboot guard glows gently.
    if (fighter.char.id === "gpt" && fighter.guardTimer > 0 && !isKo) {
      ctx.save();
      ctx.globalAlpha = 0.36 + Math.sin(time * 5) * 0.08;
      ctx.strokeStyle = "rgba(196, 241, 255, .85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, -spriteHeight * 0.47, 53, spriteHeight * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // milky aura while Doubao is transformed
    if (visual.inMilkForm && !isKo) {
      const auraY = -spriteHeight * 0.44;
      const pulse = 0.72 + Math.sin(time * 6) * 0.16;
      const milkAura = ctx.createRadialGradient(0, auraY, 4, 0, auraY, 112 * pulse);
      milkAura.addColorStop(0, "rgba(225, 253, 255, .2)");
      milkAura.addColorStop(0.52, "rgba(155, 239, 255, .08)");
      milkAura.addColorStop(1, "rgba(155, 239, 255, 0)");
      ctx.fillStyle = milkAura;
      ctx.beginPath();
      ctx.arc(0, auraY, 112 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(218, 253, 255, .38)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, 4, 52, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 3; i += 1) {
        const angle = time * 1.8 + i * (Math.PI * 2 / 3);
        const dx = Math.cos(angle) * 57;
        const dy = auraY + 10 + Math.sin(angle) * 18;
        ctx.globalAlpha = 0.44 + Math.sin(angle) * 0.18;
        ctx.fillStyle = "#e9fdff";
        ctx.beginPath();
        ctx.arc(dx, dy, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    let alpha = 1;
    if (fighter.dodgeFlash > 0) alpha = 0.43 + Math.sin(time * 40) * 0.1;
    let filter = null;
    if (fighter.hurtFlash > 0) filter = "brightness(1.75) saturate(1.5)";

    const flip = fighter.facing;
    const height = spriteHeight;
    const rotationWithLunge = isKo ? rotation : rotation + fighter.facing * (moving && fighter.support ? Math.sin(time * 12 + fighter.idleSeed) * 0.01 : 0);

    // accent floor ring
    ctx.save();
    ctx.globalAlpha = fighter === b.player ? 0.32 : 0.22;
    ctx.strokeStyle = char.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 3, 47, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(0, 0);
    ctx.rotate(rotationWithLunge);
    if (flip < 0) ctx.scale(-1, 1);
    ctx.globalAlpha = alpha;
    if (filter) ctx.filter = filter;

    // 行走帧：移动中且没有出招/受击/使用技能时，播放左右对应的行走精灵图。
    // 精灵图已按朝向画好，因此这里不再做水平翻转。
    const walkSheet = getWalkSheet(fighter, moving, isKo);
    if (walkSheet) {
      ctx.save();
      if (flip < 0) ctx.scale(-1, 1);   // 抵消外层的朝向翻转
      const cell = walkSheet.cell;
      const drawH = height / walkSheet.heightRatio;
      const drawW = (cell / cell) * drawH;
      ctx.drawImage(walkSheet.img, walkSheet.index * cell, 0, cell, cell, -drawW / 2, -drawH + 4, drawW, drawH);
      ctx.restore();
    } else if (img && img.complete && img.naturalWidth) {
      const w = (img.naturalWidth / img.naturalHeight) * height;
      ctx.drawImage(img, -w / 2, -height, w, height);
    } else {
      ctx.fillStyle = `rgba(${char.accentRgb}, .22)`;
      ctx.strokeStyle = `rgba(${char.accentRgb}, .65)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-46, -height, 92, height, 26);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // dash afterimage
    if (fighter.dashTimer > 0 && img && img.complete && img.naturalWidth) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.translate(-fighter.dashDir * 26, 0);
      if (flip < 0) ctx.scale(-1, 1);
      const w = (img.naturalWidth / img.naturalHeight) * height;
      ctx.drawImage(img, -w / 2, -height, w, height);
      ctx.restore();
    }

    // name / player marker
    if (!isKo) {
      const isLocal = fighter === (b.localFighter || b.player);
      const markerY = -height - 19 + Math.sin(time * 2.6) * 2;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = isLocal ? "#8feaff" : "#ffb08b";
      ctx.beginPath();
      ctx.moveTo(0, markerY + 6);
      ctx.lineTo(-4, markerY);
      ctx.lineTo(4, markerY);
      ctx.closePath();
      ctx.fill();
      ctx.font = `700 7px ${DISPLAY}`;
      ctx.letterSpacing = "1px";
      ctx.textAlign = "center";
      ctx.fillStyle = isLocal ? "rgba(159,239,255,.65)" : "rgba(255,180,142,.55)";
      if (visual.inMilkForm) {
        ctx.fillStyle = "rgba(196, 250, 255, .9)";
        ctx.fillText("MILK", 0, markerY - 5);
      } else {
        ctx.fillText(isLocal ? "YOU" : b.online ? "RIVAL" : "AI", 0, markerY - 5);
      }
      ctx.restore();
    }

    ctx.restore();
    ctx.filter = "none";

    // stun stars
    if (fighter.stun > 0 && !isKo) {
      for (let i = 0; i < 3; i += 1) {
        const angle = time * 3.4 + i * (Math.PI * 2 / 3);
        const sx = fighter.x + Math.cos(angle) * 30;
        const sy = fighter.y - 178 + Math.sin(angle) * 7;
        drawStar(sx, sy, 3.4, "#ffd36e", 0.85);
      }
    }

    // ghost trail on dodge
    if (fighter.dodgeFlash > 0 && img && img.complete) {
      const h = img;
      ctx.save();
      ctx.globalAlpha = fighter.dodgeFlash * 0.32;
      ctx.translate(fighter.x - fighter.vx * 0.045, fighter.y + bob);
      if (flip < 0) ctx.scale(-1, 1);
      const w = (h.naturalWidth / h.naturalHeight) * height;
      ctx.drawImage(h, -w / 2, -height, w, height);
      ctx.restore();
    }

    if (!isKo && onPlatform) {
      ctx.fillStyle = "rgba(112, 225, 255, .28)";
      ctx.fillRect(fighter.x - 23, fighter.y + 8, 46, 1);
    }
  }

  function drawStar(x, y, r, color, alpha = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = -Math.PI / 2 + i * Math.PI / 4;
      const radius = i % 2 === 0 ? r : r * 0.4;
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawNormalActionFx(b, time) {
    for (const fighter of [b.player, b.enemy]) {
      const action = fighter.action;
      if (!action || action.kind !== "normal" || action.t > action.duration * 0.9) continue;
      const p = clamp(action.t / action.duration, 0, 1);
      const char = fighter.char;
      if (char.normal.type === "melee") {
        const reach = char.normal.range;
        const dir = fighter.facing;
        const centerX = fighter.x + dir * (32 + p * 23);
        const centerY = fighter.y - 102;
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.scale(dir, 1);
        ctx.globalAlpha = 1 - Math.max(0, (p - 0.45) / 0.55) * 0.9;
        ctx.strokeStyle = char.id === "deepseek" ? "rgba(119, 224, 255, .9)" : "rgba(255, 221, 113, .9)";
        ctx.lineWidth = 4 - p * 2;
        ctx.shadowColor = char.color;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(0, 0, 42 + p * 37, -1.03, 1.02);
        ctx.stroke();
        ctx.globalAlpha *= 0.55;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, 58 + p * 42, -0.85, 0.82);
        ctx.stroke();
        if (char.id === "doubao") {
          for (let i = 0; i < 3; i += 1) {
            drawStar(
              Math.cos(i * 2.1 + p * 2) * (57 + p * reach * 0.16),
              Math.sin(i * 2.1 + p * 2) * 25,
              4 + i,
              "rgba(255, 233, 142, .85)",
              0.45 + p * 0.4
            );
          }
        }
        ctx.restore();
      } else {
        const dir = fighter.facing;
        ctx.save();
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.8;
        ctx.strokeStyle = char.color;
        ctx.lineWidth = 1.2;
        ctx.shadowColor = char.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(fighter.x + dir * 35, fighter.y - 110, 12 + p * 14, -0.8, 0.8);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawStrikeTelegraphs(b, time) {
    for (const s of b.strikes) {
      if (s.hitDone) continue;
      const p = clamp(s.t / s.delay, 0, 1);
      if (s.type === "rice") {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.globalAlpha = 0.25 + p * 0.55;
        ctx.strokeStyle = "#ffd97e";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 8]);
        ctx.lineDashOffset = -time * 25;
        ctx.beginPath();
        ctx.ellipse(0, 0, s.radius, 22, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.05 + p * 0.09;
        ctx.fillStyle = "#ffd97e";
        ctx.beginPath();
        ctx.ellipse(0, 0, s.radius, 22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        drawRiceBowl(s.x, s.y - (1 - p) * 560 - 90, 1 - p * 0.16, p);
        if (s.center) {
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = "rgba(255, 226, 153, .8)";
          ctx.font = `700 8px ${DISPLAY}`;
          ctx.letterSpacing = "1.5px";
          ctx.textAlign = "center";
          ctx.fillText("白饭预警 ×3", s.x, s.y - 31);
          ctx.restore();
        }
      } else if (s.type === "ban") {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.globalAlpha = 0.22 + p * 0.55;
        ctx.strokeStyle = "#ff9a63";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 7]);
        ctx.lineDashOffset = time * 32;
        ctx.beginPath();
        ctx.ellipse(0, 0, s.radius, 29, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.06 + p * 0.12;
        ctx.fillStyle = "#ff9a63";
        ctx.beginPath();
        ctx.ellipse(0, 0, s.radius, 29, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        drawBanHammer(s.x, s.y - (1 - p) * 500 - 100, 1 - p * 0.12);
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = "rgba(255, 172, 126, .85)";
        ctx.font = `700 8px ${DISPLAY}`;
        ctx.letterSpacing = "1.5px";
        ctx.textAlign = "center";
        ctx.fillText("封号预警", s.x, s.y - 38);
        ctx.restore();
      } else if (s.type === "beam") {
        const top = s.y - s.height / 2;
        const bottom = s.y + s.height / 2;
        const beamLeft = clamp(Math.min(s.originX, s.originX + s.facing * s.length), ARENA.wallL, ARENA.wallR);
        const beamRight = clamp(Math.max(s.originX, s.originX + s.facing * s.length), ARENA.wallL, ARENA.wallR);
        const beamWidth = Math.max(0, beamRight - beamLeft);
        ctx.save();
        ctx.globalAlpha = 0.18 + p * 0.34;
        ctx.fillStyle = "rgba(169, 192, 255, .16)";
        ctx.fillRect(beamLeft, top, beamWidth, s.height);
        ctx.strokeStyle = "rgba(169, 192, 255, .6)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 10]);
        ctx.lineDashOffset = -time * 50;
        ctx.beginPath();
        ctx.moveTo(beamLeft, top);
        ctx.lineTo(beamRight, top);
        ctx.moveTo(beamLeft, bottom);
        ctx.lineTo(beamRight, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(215, 225, 255, .8)";
        ctx.font = `700 8px ${DISPLAY}`;
        ctx.letterSpacing = "2px";
        ctx.textAlign = "center";
        ctx.fillText("半场上下文注入中" + " ".repeat(Math.floor(time * 8) % 4), (beamLeft + beamRight) / 2, top - 12);
        ctx.restore();
      }
    }
  }

  function drawStrikes(b, time) {
    for (const s of b.strikes) {
      if (s.type === "beam") {
        const p = s.t - s.delay;
        const active = s.hitDone && p >= 0 && p < 0.24;
        const top = s.y - s.height / 2;
        if (active) {
          const fade = 1 - clamp(p / 0.24, 0, 1);
          const beamLeft = clamp(Math.min(s.originX, s.originX + s.facing * s.length), ARENA.wallL, ARENA.wallR);
          const beamRight = clamp(Math.max(s.originX, s.originX + s.facing * s.length), ARENA.wallL, ARENA.wallR);
          const beamWidth = Math.max(0, beamRight - beamLeft);
          ctx.save();
          ctx.globalAlpha = 0.8 * fade;
          const grad = ctx.createLinearGradient(0, top, 0, top + s.height);
          grad.addColorStop(0, "rgba(153, 189, 255, .05)");
          grad.addColorStop(0.3, "rgba(196, 220, 255, .95)");
          grad.addColorStop(0.5, "rgba(255, 255, 255, .98)");
          grad.addColorStop(0.72, "rgba(175, 201, 255, .8)");
          grad.addColorStop(1, "rgba(153, 189, 255, .03)");
          ctx.fillStyle = grad;
          ctx.shadowColor = "rgba(152, 191, 255, .9)";
          ctx.shadowBlur = 28;
          ctx.fillRect(beamLeft, top, beamWidth, s.height);
          ctx.globalAlpha = 0.7 * fade;
          ctx.fillStyle = "rgba(39, 89, 144, .4)";
          for (let i = 0; i < 16; i += 1) {
            const x = beamLeft + ((i * 57 + time * 920) % Math.max(beamWidth, 1));
            ctx.fillRect(x, top + 6 + (i % 3) * 18, 2, 3);
          }
          ctx.restore();
        }
        continue;
      }

      if (s.hitDone) {
        const p = (s.t - s.delay) / Math.max(s.linger, 0.01);
        const alpha = clamp(1 - p, 0, 1);
        if (s.type === "rice") {
          drawRiceImpact(s.x, s.y, alpha);
        } else {
          drawBanImpact(s.x, s.y, alpha);
        }
      }
    }
  }

  function drawRiceBowl(x, y, scale, progress) {
    if (y < -130 || y > GROUND_Y + 30) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = clamp(0.2 + progress * 0.9, 0, 1);
    const bowlGrad = ctx.createLinearGradient(0, -20, 0, 45);
    bowlGrad.addColorStop(0, "#ffffff");
    bowlGrad.addColorStop(0.5, "#dceeff");
    bowlGrad.addColorStop(1, "#7fa9c5");
    ctx.fillStyle = bowlGrad;
    ctx.strokeStyle = "rgba(255, 247, 214, .9)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255, 224, 144, .55)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.ellipse(0, 8, 58, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // rice mound
    ctx.beginPath();
    ctx.ellipse(0, -3, 53, 30, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = "#fffdf1";
    ctx.fill();
    ctx.strokeStyle = "rgba(233, 227, 193, .8)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // bowl body
    ctx.beginPath();
    ctx.moveTo(-58, 7);
    ctx.quadraticCurveTo(-45, 50, 0, 54);
    ctx.quadraticCurveTo(45, 50, 58, 7);
    ctx.closePath();
    ctx.fillStyle = "rgba(181, 222, 246, .92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.8)";
    ctx.stroke();
    // blue rim motif
    ctx.strokeStyle = "rgba(72, 142, 196, .8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 7, 56, 10, 0, 0, Math.PI);
    ctx.stroke();
    ctx.fillStyle = "rgba(33, 75, 110, .5)";
    ctx.font = `700 9px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.fillText("白饭", 0, 33);
    ctx.restore();
  }

  function drawRiceImpact(x, y, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(255, 226, 149, .8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, 40 + (1 - alpha) * 100, 10 + (1 - alpha) * 22, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 241, 188, .1)";
    ctx.beginPath();
    ctx.ellipse(x, y, 90, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    // little rice grains
    for (let i = 0; i < 9; i += 1) {
      const angle = i * 0.9 + 1.2;
      const r = 20 + (1 - alpha) * 75;
      ctx.save();
      ctx.translate(x + Math.cos(angle) * r, y - 20 + Math.sin(angle) * r * 0.24);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(255, 248, 215, .8)";
      ctx.fillRect(-3, -1, 6, 2);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawBanHammer(x, y, scale) {
    if (y < -160 || y > GROUND_Y + 50) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.shadowColor = "rgba(255, 121, 84, .4)";
    ctx.shadowBlur = 18;
    ctx.rotate(0.1);
    // handle
    const handle = ctx.createLinearGradient(-7, 0, 7, 0);
    handle.addColorStop(0, "#593523");
    handle.addColorStop(0.5, "#b27a53");
    handle.addColorStop(1, "#4a291b");
    ctx.fillStyle = handle;
    ctx.fillRect(-7, -104, 14, 170);
    ctx.fillStyle = "#ffc276";
    ctx.fillRect(-2, -104, 4, 170);
    // head
    const head = ctx.createLinearGradient(0, -154, 0, -93);
    head.addColorStop(0, "#88796e");
    head.addColorStop(0.45, "#d4c1a9");
    head.addColorStop(1, "#66534a");
    ctx.fillStyle = head;
    ctx.strokeStyle = "rgba(255, 219, 171, .7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-66, -156, 132, 65, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(92, 47, 36, .45)";
    ctx.fillRect(-50, -146, 4, 44);
    ctx.fillRect(44, -146, 4, 44);
    ctx.fillStyle = "rgba(255, 216, 173, .85)";
    ctx.font = `800 17px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.letterSpacing = "3px";
    ctx.fillText("BAN", 0, -118);
    ctx.strokeStyle = "rgba(255, 176, 117, .7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, -125, 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBanImpact(x, y, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(255, 152, 100, .82)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, 50 + (1 - alpha) * 120, 16 + (1 - alpha) * 32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 211, 160, .3)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i += 1) {
      const a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 30, y + Math.sin(a) * 8);
      ctx.lineTo(x + Math.cos(a) * (75 + (1 - alpha) * 65), y + Math.sin(a) * (25 + (1 - alpha) * 30));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawProjectiles(b, time) {
    for (const p of b.projectiles) {
      if (p.kind === "feather") drawFeather(p, time);
      else if (p.kind === "note") drawNote(p, time);
      else if (p.kind === "page") drawPage(p, time);
      else if (p.kind === "scroll") drawScroll(p, time);
      else if (p.kind === "bubble") drawBubble(p, time);
    }
  }

  function drawFeather(p, time) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + Math.sin(time * 8) * 0.06);
    ctx.shadowColor = p.empowered ? "rgba(213, 193, 255, .95)" : "rgba(226, 221, 255, .9)";
    ctx.shadowBlur = p.empowered ? 25 : 16;
    if (p.empowered) {
      ctx.strokeStyle = "rgba(204, 181, 255, .55)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 37, 15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 253, 255, .95)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 24, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-28, 0);
    ctx.lineTo(10, -5);
    ctx.lineTo(27, 0);
    ctx.lineTo(10, 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(189, 184, 255, .9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    ctx.lineTo(25, 0);
    ctx.stroke();
    ctx.strokeStyle = "rgba(207, 202, 255, .5)";
    for (let i = -10; i < 15; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 6, -4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawNote(p, time) {
    const wobble = Math.sin(time * 7 + p.x * 0.03) * 5;
    ctx.save();
    ctx.translate(p.x, p.y + wobble);
    ctx.rotate(Math.sin(time * 4) * 0.1);
    ctx.shadowColor = "rgba(181, 203, 255, .9)";
    ctx.shadowBlur = 15;
    ctx.fillStyle = "rgba(231, 241, 255, .95)";
    ctx.strokeStyle = "rgba(170, 202, 255, .9)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(-7, 7, 9, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.lineTo(0, -17);
    ctx.quadraticCurveTo(13, -17, 15, -5);
    ctx.stroke();
    ctx.fillStyle = "rgba(176, 209, 255, .85)";
    ctx.beginPath();
    ctx.arc(13, -8, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPage(p, time) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + time * 5);
    ctx.shadowColor = "rgba(255, 165, 103, .7)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(255, 246, 224, .95)";
    ctx.strokeStyle = "rgba(161, 109, 72, .7)";
    ctx.lineWidth = 1;
    ctx.fillRect(-24, -14, 48, 28);
    ctx.strokeRect(-24, -14, 48, 28);
    ctx.strokeStyle = "rgba(187, 145, 105, .55)";
    ctx.lineWidth = 0.8;
    for (let i = -8; i <= 8; i += 5) {
      ctx.beginPath();
      ctx.moveTo(-18, i);
      ctx.lineTo(13, i);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(229, 100, 58, .65)";
    ctx.beginPath();
    ctx.arc(14, 5, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawScroll(p, time) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(time * 4 + p.x * 0.01) * 0.035);
    // The scroll artwork is intentionally half-size; its gameplay hitbox is unchanged.
    ctx.scale(0.5, 0.5);
    ctx.shadowColor = "rgba(222, 211, 255, .35)";
    ctx.shadowBlur = 22;
    const grad = ctx.createLinearGradient(0, -p.h / 2, 0, p.h / 2);
    grad.addColorStop(0, "#f4eddf");
    grad.addColorStop(0.48, "#dcd2c0");
    grad.addColorStop(1, "#aa9d8e");
    ctx.fillStyle = grad;
    ctx.strokeStyle = "rgba(255, 251, 233, .75)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 10);
    ctx.fill();
    ctx.stroke();
    // rolled edges
    ctx.fillStyle = "rgba(87, 72, 60, .45)";
    ctx.beginPath();
    ctx.roundRect(-p.w / 2 - 8, -p.h / 2 + 6, 16, p.h - 12, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(p.w / 2 - 8, -p.h / 2 + 6, 16, p.h - 12, 8);
    ctx.fill();
    // text lines
    ctx.strokeStyle = "rgba(110, 94, 78, .55)";
    ctx.lineWidth = 1.1;
    for (let row = 0; row < 6; row += 1) {
      ctx.beginPath();
      ctx.moveTo(-p.w / 2 + 23, -p.h / 2 + 19 + row * 12);
      ctx.lineTo(p.w / 2 - (row % 3 === 0 ? 43 : 25), -p.h / 2 + 19 + row * 12);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(157, 63, 51, .8)";
    ctx.beginPath();
    ctx.arc(p.w / 2 - 27, p.h / 2 - 23, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 244, 218, .8)";
    ctx.font = `700 7px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.fillText("文", p.w / 2 - 27, p.h / 2 - 20);
    ctx.restore();
  }

  function drawBubble(p, time) {
    const labels = ["已读", "乱回", "?"];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(time * 5 + p.variant) * 0.07);
    ctx.shadowColor = "rgba(255, 208, 87, .5)";
    ctx.shadowBlur = 13;
    const grad = ctx.createLinearGradient(0, -p.h / 2, 0, p.h / 2);
    grad.addColorStop(0, "rgba(255, 248, 206, .98)");
    grad.addColorStop(1, "rgba(255, 200, 82, .9)");
    ctx.fillStyle = grad;
    ctx.strokeStyle = "rgba(255, 247, 194, .9)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-25, -18, 50, 33, 10);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, 14);
    ctx.lineTo(-18, 24);
    ctx.lineTo(2, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(109, 74, 25, .45)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(91, 63, 18, .8)";
    ctx.font = `700 10px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.fillText(labels[p.variant % labels.length], 0, 4);
    // tiny dots
    ctx.fillStyle = "rgba(255, 255, 230, .72)";
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(17 + i * 3.3, -20, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles(b) {
    for (const p of b.particles) {
      const alpha = clamp(1 - p.age / p.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.shape === "line") {
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawRings(b) {
    for (const r of b.rings) {
      const t = clamp(r.age / r.life, 0, 1);
      const radius = r.maxRadius * (0.2 + t * 0.8);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.75;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, radius, radius * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawFloats(b) {
    for (const f of b.floats) {
      const t = clamp(f.age / f.life, 0, 1);
      // 前半段淡入，后半段淡出；开头 12% 做一个放大回弹，让数字"跳"出来更好读。
      const alpha = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      const pop = t < 0.18 ? 1 + (1 - t / 0.18) * 0.35 : 1;
      const size = Math.round(f.size * pop);
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.translate(f.x, f.y);
      ctx.font = `900 ${size}px ${DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // 描边加粗并加深，保证亮色数字在任何背景上都清晰可读。
      ctx.lineWidth = Math.max(4, size * 0.18);
      ctx.strokeStyle = "rgba(2, 6, 12, .82)";
      ctx.lineJoin = "round";
      ctx.strokeText(f.text, 0, 0);
      ctx.shadowColor = f.color;
      ctx.shadowBlur = size * 0.6;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
  }

  function drawForeground(b, time) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    // energy leaking along the ground line
    for (let i = 0; i < 4; i += 1) {
      const x = ((time * 28 + i * 330) % (W + 120)) - 60;
      ctx.fillStyle = i % 2 ? "rgba(98, 219, 255, .25)" : "rgba(255, 194, 104, .22)";
      ctx.fillRect(x, GROUND_Y - 1, 45 + i * 20, 1);
    }
    ctx.restore();
  }

  function drawHudArenaText(b, time) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = "rgba(157, 214, 242, .55)";
    ctx.font = `600 7px ${DISPLAY}`;
    ctx.letterSpacing = "2px";
    ctx.textAlign = "left";
    ctx.fillText(`SECTOR 0${b.player.char.id === "deepseek" ? "1" : "2"}  /  TOKEN-LINK STABLE`, ARENA.wallL + 18, GROUND_Y + 48);
    ctx.textAlign = "right";
    ctx.fillText(`T-${Math.ceil(b.timeLeft).toString().padStart(2, "0")}  /  NO DOUBLE JUMP`, ARENA.wallR - 18, GROUND_Y + 48);
    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════
     HUD updating
     ═══════════════════════════════════════════════════════ */
  const hudCache = new Map();
  function setText(el, text) {
    if (hudCache.get(el) === text) return;
    hudCache.set(el, text);
    el.textContent = text;
  }
  function setWidth(el, width) {
    const value = `${clamp(width, 0, 100).toFixed(2)}%`;
    if (el.style.width !== value) el.style.width = value;
  }

  function updateHud(b) {
    if (!b) return;
    const p = b.player;
    const e = b.enemy;
    const local = b.localFighter || b.player;
    const localInForm = local.milkTimer > 0 && !!local.char.formImage;

    const pInForm = p.milkTimer > 0 && !!p.char.formImage;
    const eInForm = e.milkTimer > 0 && !!e.char.formImage;
    const pSrc = pInForm ? p.char.formImage : p.char.image;
    const eSrc = eInForm ? e.char.formImage : e.char.image;
    if (ui.playerAvatar.getAttribute("src") !== pSrc) {
      ui.playerAvatar.src = pSrc;
      ui.playerAvatar.style.objectPosition = pInForm ? "50% 8%" : p.char.id === "doubao" ? "50% 16%" : "50% 14%";
    }
    if (ui.enemyAvatar.getAttribute("src") !== eSrc) {
      ui.enemyAvatar.src = eSrc;
      ui.enemyAvatar.style.objectPosition = eInForm ? "50% 8%" : e.char.id === "doubao" ? "50% 16%" : "50% 14%";
    }
    setText(ui.playerHudName, pInForm ? "豆奶" : p.char.name);
    setText(ui.enemyHudName, eInForm ? "豆奶" : e.char.name);
    if (b.online) {
      setText(ui.playerHudTag, pInForm ? `豆奶形态 ${Math.ceil(p.milkTimer)}s · P1` : `${p.char.title} · P1`);
      setText(ui.enemyHudTag, eInForm ? `豆奶形态 ${Math.ceil(e.milkTimer)}s · P2` : `${e.char.title} · P2`);
    } else {
      setText(ui.playerHudTag, pInForm ? `豆奶形态 ${Math.ceil(p.milkTimer)}s` : p.char.title);
      setText(ui.enemyHudTag, eInForm ? `豆奶形态 ${Math.ceil(e.milkTimer)}s · AI` : `${e.char.title} · AI`);
    }
    setText(ui.abilityNormalName, localInForm ? "豆奶冲撞" : local.char.normal.name);
    setText(ui.abilitySkillName, local.char.skill.name);
    setText(ui.abilitySkillCost, `${local.char.skill.cost} TOKEN`);

    setText(ui.playerHpText, `${Math.ceil(p.hp)} / ${p.char.hpMax}`);
    setText(ui.enemyHpText, `${Math.ceil(e.hp)} / ${e.char.hpMax}`);
    setText(ui.playerTokenText, `${Math.floor(p.token)}`);
    setText(ui.enemyTokenText, `${Math.floor(e.token)}`);

    setWidth(ui.playerHpFill, (p.hp / p.char.hpMax) * 100);
    setWidth(ui.enemyHpFill, (e.hp / e.char.hpMax) * 100);
    setWidth(ui.playerTokenFill, (p.token / p.char.tokenMax) * 100);
    setWidth(ui.enemyTokenFill, (e.token / e.char.tokenMax) * 100);

    const time = b.phase === "countdown" ? 99 : Math.ceil(b.timeLeft);
    setText(ui.timerText, String(Math.max(0, time)));

    const normalCd = Math.max(0, local.normalCd);
    const skillCd = Math.max(0, local.skillCd);
    const normalReady = normalCd <= 0.001 && !local.action;
    const skillNoToken = local.token < local.char.skill.cost;

    ui.normalAbility.classList.toggle("is-cooling", !normalReady);
    ui.normalAbility.classList.remove("is-no-token");
    ui.skillAbility.classList.toggle("is-cooling", skillCd > 0.001 || !!local.action);
    ui.skillAbility.classList.toggle("is-no-token", skillNoToken && skillCd <= 0.001);

    if (normalCd > 0.02) setText(ui.normalState, `${normalCd.toFixed(1)}s`);
    else setText(ui.normalState, "READY");

    if (skillCd > 0.02) setText(ui.skillState, `${skillCd.toFixed(1)}s`);
    else if (skillNoToken) setText(ui.skillState, `缺 ${Math.ceil(local.char.skill.cost - local.token)}`);
    else setText(ui.skillState, "READY");

    const normalPct = normalCd > 0 ? (1 - normalCd / local.char.normal.cooldown) * 100 : 100;
    const skillPct = skillCd > 0
      ? (1 - skillCd / local.char.skill.cooldown) * 100
      : skillNoToken
        ? (local.token / local.char.skill.cost) * 100
        : 100;
    setWidth(ui.normalProgress, normalPct);
    setWidth(ui.skillProgress, skillPct);

    setText(ui.guideSkillName, local.char.skill.name);
    if (skillCd > 0.02) setText(ui.guideSkillState, `${skillCd.toFixed(1)}s`);
    else if (skillNoToken) setText(ui.guideSkillState, `缺 ${Math.ceil(local.char.skill.cost - local.token)}`);
    else setText(ui.guideSkillState, "READY");
    ui.guideSkill.classList.toggle("is-cooling", skillCd > 0.02);
    ui.guideSkill.classList.toggle("is-no-token", skillCd <= 0.02 && skillNoToken);
    setWidth(ui.guideSkillFill, skillPct);
    ui.skillCdOrb.style.setProperty("--cd-progress", clamp(skillPct, 0, 100).toFixed(2));
  }

  /* ═══════════════════════════════════════════════════════
     Main loop
     ═══════════════════════════════════════════════════════ */
  let lastFrame = performance.now();
  function loop(now) {
    const dt = Math.min(Math.max((now - lastFrame) / 1000, 0), 0.033);
    lastFrame = now;

    if (battle) {
      if (battle.online && battle.online.role === "guest") {
        battle.visualTime += dt;
        // 访客端：把角色平滑地拉向最新快照位置（约 12 帧内到位），
        // 消除逐帧硬赋值带来的瞬移感，让高延迟下也看得清动作。
        const lerpK = Math.min(1, dt * 18);
        for (const fighter of [battle.player, battle.enemy]) {
          const t = fighter.netTarget;
          if (!t) continue;
          const dist = Math.hypot(t.x - fighter.x, t.y - fighter.y);
          if (dist < 180) {
            fighter.x += (t.x - fighter.x) * lerpK;
            fighter.y += (t.y - fighter.y) * lerpK;
          } else {
            fighter.x = t.x;
            fighter.y = t.y;
          }
        }
      } else if (battle.phase !== "paused" && battle.phase !== "over") {
        updateBattle(dt);
      } else {
        battle.visualTime += dt;
        updateCosmetics(battle, dt);
      }
      renderBattle();
      updateHud(battle);
      if (battle.online && battle.online.role === "host") {
        maybeSendOnlineSnapshot(now);
      }
    }

    requestAnimationFrame(loop);
  }

  /* ═══════════════════════════════════════════════════════
     Events
     ═══════════════════════════════════════════════════════ */
  ui.startBtn.addEventListener("click", () => {
    if (online || selectedMode !== "ai") return;
    startBattle(selectedId, null, { difficulty: selectedDifficulty });
  });
  ui.selectSoundBtn.addEventListener("click", () => AudioEngine.toggle());
  ui.battleSoundBtn.addEventListener("click", () => AudioEngine.toggle());
  ui.settingsBtn.addEventListener("click", () => openSettings("volume"));
  ui.fullscreenBtn.addEventListener("click", toggleFullscreen);
  ui.settingsFullscreenBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenUi);
  ui.settingsCloseBtn.addEventListener("click", closeSettings);
  ui.noticeCloseBtn.addEventListener("click", () => closeNotice(true));
  ui.noticeEnterBtn.addEventListener("click", () => closeNotice(true));
  ui.openNoticeFromKeys.addEventListener("click", openNotice);
  ui.openNoticeFromSettings.addEventListener("click", openNotice);
  for (const tab of ui.settingsTabs) {
    tab.addEventListener("click", () => {
      setSettingsTab(tab.dataset.settingsTab);
      AudioEngine.play("ui");
    });
  }
  for (const tab of ui.noticeTabs) {
    tab.addEventListener("click", () => {
      setNoticePage(tab.dataset.noticeTab);
      AudioEngine.play("ui");
    });
  }
  for (const chip of ui.copyChips) bindCopyChip(chip);
  ui.volumeSlider.addEventListener("input", () => {
    AudioEngine.setVolume(Number(ui.volumeSlider.value));
  });
  ui.volumeSlider.addEventListener("change", () => {
    AudioEngine.unlock();
    if (AudioEngine.enabled) AudioEngine.play("ui");
    syncAudioControls();
  });
  ui.settingsSoundToggle.addEventListener("click", () => AudioEngine.toggle());
  ui.volumeTestBtn.addEventListener("click", () => {
    AudioEngine.unlock();
    if (!AudioEngine.enabled) AudioEngine.toggle();
    else AudioEngine.play("ui");
    syncAudioControls();
  });
  ui.noticeOverlay.addEventListener("click", (event) => {
    if (event.target === ui.noticeOverlay) closeNotice(true);
  });
  ui.settingsOverlay.addEventListener("click", (event) => {
    if (event.target === ui.settingsOverlay) closeSettings();
  });
  ui.pauseBtn.addEventListener("click", () => {
    if (!battle || battle.online) return;
    if (battle.phase === "fighting") pauseBattle();
    else if (battle.phase === "paused") resumeBattle();
  });
  ui.resumeBtn.addEventListener("click", resumeBattle);
  ui.quitBtn.addEventListener("click", returnToSelect);
  ui.rematchBtn.addEventListener("click", handleRematchClick);
  ui.changeBtn.addEventListener("click", handleEndResult);

  for (const button of ui.modeButtons) {
    button.addEventListener("click", () => {
      if (online) return;
      setMode(button.dataset.mode);
    });
  }
  for (const button of ui.difficultyButtons) {
    button.addEventListener("click", () => {
      setDifficulty(button.dataset.difficulty);
      AudioEngine.play("ui");
    });
  }
  ui.descModeBtn.addEventListener("click", () => {
    setDescriptionMode(!compactDescriptions);
    AudioEngine.play("ui");
  });
  ui.createRoomBtn.addEventListener("click", connectAndCreateRoom);
  ui.joinRoomBtn.addEventListener("click", connectAndJoinRoom);
  ui.roomCodeInput.addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      event.preventDefault();
      connectAndJoinRoom();
    }
  });
  ui.copyRoomBtn.addEventListener("click", async () => {
    if (!online || !online.roomId) return;
    const base = publicInviteBase || (location.protocol === "file:" ? "" : `${location.origin}${location.pathname}`);
    const invite = base ? `${base}?room=${encodeURIComponent(online.roomId)}&autojoin=1` : "";
    const text = invite
      ? `AI 娘 · 破界对决 联机邀请\n${invite}\n房间码：${online.roomId}`
      : `AI 娘 · 破界对决 房间码：${online.roomId}`;
    const ok = await copyTextToClipboard(text);
    const oldLabel = ui.copyRoomBtn.textContent;
    ui.copyRoomBtn.textContent = ok ? "已复制邀请" : "复制失败";
    ui.onlineWaitText.textContent = ok
      ? "邀请已复制。好友打开链接后会自动加入房间。"
      : `房间码：${online.roomId}`;
    window.setTimeout(() => {
      ui.copyRoomBtn.textContent = oldLabel;
    }, 1500);
    AudioEngine.play("ui");
  });
  ui.cancelOnlineBtn.addEventListener("click", () => {
    leaveOnlineRoom("online");
  });
  ui.onlineConfirmBtn.addEventListener("click", () => confirmOnlineSelection(false));
  ui.onlineLeaveBtn.addEventListener("click", () => {
    leaveOnlineRoom("online");
  });
  window.addEventListener("beforeunload", () => {
    if (online) Network.close(true);
  });

  window.addEventListener("resize", resizeCanvas);

  /* ═══════════════════════════════════════════════════════
     Init
     ═══════════════════════════════════════════════════════ */
  buildRoster();
  try {
    const savedDescMode = localStorage.getItem("ai-arena-description-mode");
    if (savedDescMode === "full") compactDescriptions = false;
  } catch (e) { /* privacy mode */ }
  selectCharacter("deepseek", { silent: true });
  setDifficulty(selectedDifficulty);
  setMode("ai", { force: true });
  syncAudioControls();
  syncFullscreenUi();
  preloadArt();
  resizeCanvas();
  requestAnimationFrame(loop);

  // Small debug/demo hooks keep automated visual checks possible.
  const params = new URLSearchParams(window.location.search);
  const publicParam = params.get("public");
  publicLineName = params.get("line") || "";
  publicLineMs = Number(params.get("lineMs")) || 0;
  if (ui.onlineRoute && publicLineName) {
    ui.onlineRoute.hidden = false;
    ui.onlineRoute.textContent = `当前最快公网线路：${publicLineName}${publicLineMs > 0 ? ` · 入口测速 ${Math.round(publicLineMs)}ms` : ""}`;
  }
  if (publicParam) {
    try {
      const publicUrl = new URL(publicParam);
      if (publicUrl.protocol === "http:" || publicUrl.protocol === "https:") {
        publicInviteBase = `${publicUrl.origin}${publicUrl.pathname}`;
      }
    } catch (e) { /* ignore malformed public URL */ }
  }
  const demo = params.get("demo");
  if (demo && BY_ID[demo]) {
    selectCharacter(demo, { silent: true });
  }
  const roomFromUrl = extractRoomCode(params.get("room") || "");
  const inviteAutoJoin = params.get("autojoin") === "1" && !!roomFromUrl;
  if (roomFromUrl) {
    setMode("online", { force: true });
    ui.roomCodeInput.value = roomFromUrl;
  }
  const showWelcome = params.get("nointro") !== "1" && shouldShowWelcomeNotice();
  if (showWelcome) {
    if (inviteAutoJoin) pendingAutoJoin = true;
    window.setTimeout(() => {
      if (!isDialogOpen()) openNotice();
    }, 480);
  } else if (inviteAutoJoin) {
    window.setTimeout(() => {
      if (!online) connectAndJoinRoom();
    }, 600);
  }
  if (!roomFromUrl && (params.get("auto") === "1" || params.get("autostart") === "1")) {
    const enemy = params.get("enemy") || params.get("opponent");
    const difficulty = AI_DIFFICULTIES[params.get("difficulty")] ? params.get("difficulty") : selectedDifficulty;
    window.setTimeout(() => {
      startBattle(BY_ID[demo] ? demo : selectedId, enemy || null, {
        fast: params.get("fast") === "1",
        difficulty
      });
    }, 160);
  }

  window.AIArena = {
    get battle() { return battle; },
    characters: CHARACTERS,
    start: startBattle,
    select: selectCharacter,
    damage: dealDamage,
    finish: finishBattle,
    normal: (isPlayer = true) => tryNormal(isPlayer ? battle.player : battle.enemy, battle),
    skill: (isPlayer = true) => trySkill(isPlayer ? battle.player : battle.enemy, battle),
    dash: (isPlayer = true) => tryDash(isPlayer ? battle.player : battle.enemy, battle),
    jump: (isPlayer = true) => { (isPlayer ? battle.player : battle.enemy).jumpBuffer = 0.13; }
  };
})();
