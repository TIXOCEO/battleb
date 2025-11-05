// core/db.js
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database.db');
let db;

function initDB() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);

      const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      db.exec(sql, (err) => {
        if (err) return reject(err);
        console.log('Database schema loaded');
        resolve();
      });
    });
  });
}

function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getUser(id) {
  return get(`SELECT * FROM users WHERE id = ?`, [id]);
}

function updateUserBP(id, bp) {
  return run(`UPDATE users SET bp = bp + ? WHERE id = ?`, [bp, id]);
}

module.exports = { initDB, run, get, all, getUser, updateUserBP, db };