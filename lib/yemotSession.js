/**
 * Management API של ימות המשיח.
 * הטוקן המתקדם מתקבל מהפרמטר שמוגדר בשלוחת type=api.
 * אין Login, מספר מערכת, סיסמה או משתני סביבה.
 */
'use strict';

const fetch = require('node-fetch');
const MANAGEMENT_API_BASE = 'https://www.call2all.co.il/ym/api';

async function callManagementApi(command, params = {}, options = {}, advancedToken) {
  const token = String(advancedToken || '').trim();
  if (!token) {
    const error = new Error('חסר טוקן API מתקדם. הגדירו YemotAdvancedToken בשלוחת ה-API');
    error.code = 'MISSING_YEMOT_API_TOKEN';
    throw error;
  }
  const query = new URLSearchParams({ ...params, token });
  return fetch(`${MANAGEMENT_API_BASE}/${command}?${query.toString()}`, {
    method: 'GET',
    ...options,
  });
}

module.exports = { callManagementApi };
