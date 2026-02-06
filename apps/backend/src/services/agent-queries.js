'use strict';

const { getDb } = require('../db/schema');

function getAgentById(id) {
  return getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id);
}

function getActiveAgentById(id) {
  return getDb().prepare("SELECT * FROM agents WHERE id = ? AND status = 'active'").get(id);
}

function getAgentByKeyHash(keyHash) {
  return getDb().prepare('SELECT * FROM agents WHERE api_key = ?').get(keyHash);
}

function getActiveAgentByKeyHash(keyHash) {
  return getDb().prepare("SELECT * FROM agents WHERE api_key = ? AND status = 'active'").get(keyHash);
}

function getActiveAgentByBotToken(tokenHash) {
  return getDb().prepare("SELECT * FROM agents WHERE bot_token_hash = ? AND status = 'active'").get(tokenHash);
}

function getAgentsByOwner(ownerId, status = 'active') {
  return getDb().prepare('SELECT * FROM agents WHERE owner_id = ? AND status = ?').all(ownerId, status);
}

function getAllActiveAgents(limit = 10000) {
  return getDb().prepare("SELECT * FROM agents WHERE status = 'active' LIMIT ?").all(limit);
}

module.exports = {
  getAgentById,
  getActiveAgentById,
  getAgentByKeyHash,
  getActiveAgentByKeyHash,
  getActiveAgentByBotToken,
  getAgentsByOwner,
  getAllActiveAgents,
};
