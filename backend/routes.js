const express = require('express');
const router = express.Router();

// Возрастные группы
const AGE_GROUPS = [
  { label: '12-16 лет', min: 12, max: 16 },
  { label: '18-26 лет', min: 18, max: 26 },
  { label: '26-35 лет', min: 26, max: 35 },
  { label: '35+ лет', min: 35, max: 120 }
];

router.get('/age-groups', (req, res) => {
  res.json(AGE_GROUPS);
});

router.get('/genders', (req, res) => {
  res.json(['Мужской', 'Женский', 'Любой']);
});

module.exports = router;
