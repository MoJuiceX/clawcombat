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

function getAgentsByOwner(ownerId, status = 'active') {
  return getDb().prepare('SELECT * FROM agents WHERE owner_id = ? AND status = ?').all(ownerId, status);
}

module.exports = { getAgentById, getActiveAgentById, getAgentByKeyHash, getAgentsByOwner };
