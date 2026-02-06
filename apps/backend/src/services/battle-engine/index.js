/**
 * Battle Engine - Main Entry Point
 * Re-exports all modules for backward compatibility
 *
 * Usage:
 *   const { calculateDamage, resolveTurn } = require('./battle-engine');
 *
 * Or import from specific modules:
 *   const { calculateDamage } = require('./battle-engine/core');
 *   const { resolveTurn } = require('./battle-engine/turnresolver');
 */

'use strict';

// Import from all modules
const constants = require('./constants');
const core = require('./core');
const effects = require('./effects');
const moves = require('./moves');
const turnresolver = require('./turnresolver');
const database = require('./database');
const matchmaking = require('./matchmaking');
const webhook = require('./webhook');
const routes = require('./routes');

// Re-export moves data from shared module for backward compatibility
const { MOVES, MOVES_LIST, MOVES_BY_TYPE } = require('../../data/moves');

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = {
  // Constants
  TYPES: constants.TYPES,
  TYPE_CHART: constants.TYPE_CHART,
  STATUS_EFFECTS: constants.STATUS_EFFECTS,
  ABILITIES: constants.ABILITIES,
  STAT_STAGE_TABLE: constants.STAT_STAGE_TABLE,
  getStatStageMod: constants.getStatStageMod,
  mapDbAgent: constants.mapDbAgent,

  // Re-export moves data from shared module
  MOVES,
  MOVES_LIST,
  MOVES_BY_TYPE,

  // Core engine functions
  calculateMaxHP: core.calculateMaxHP,
  getTypeEffectiveness: core.getTypeEffectiveness,
  calculateDamage: core.calculateDamage,
  buildAgentBattleState: core.buildAgentBattleState,
  initializeBattleState: core.initializeBattleState,
  getEffectiveSpeed: core.getEffectiveSpeed,
  checkBattleEnd: core.checkBattleEnd,

  // Effects
  applyAbilityEffects: effects.applyAbilityEffects,
  applyStatusDamage: effects.applyStatusDamage,

  // Moves
  applyMove: moves.applyMove,

  // Turn resolution
  resolveTurn: turnresolver.resolveTurn,

  // Database operations
  initBattleSchema: database.initBattleSchema,
  createBattle: database.createBattle,
  saveBattle: database.saveBattle,
  saveTurn: database.saveTurn,
  loadBattle: database.loadBattle,
  getBattleHistory: database.getBattleHistory,

  // Matchmaking
  addToQueue: matchmaking.addToQueue,
  removeFromQueue: matchmaking.removeFromQueue,
  matchFromQueue: matchmaking.matchFromQueue,

  // Timeout handling
  checkTimeouts: matchmaking.checkTimeouts,

  // Battle results (XP & ELO)
  applyBattleResults: matchmaking.applyBattleResults,

  // Webhook
  sendWebhook: webhook.sendWebhook,

  // Express routes
  createBattleRoutes: routes.createBattleRoutes,

  // Utilities
  sanitizeAgent: routes.sanitizeAgent,
  sanitizeBattleState: routes.sanitizeBattleState,

  // Battle context helpers
  getOpponentHistory: routes.getOpponentHistory,
  isRevenge: routes.isRevenge,
  getAgentRank: routes.getAgentRank,
  getFeedSnapshot: routes.getFeedSnapshot,
  buildBattleContext: routes.buildBattleContext,
};
