-- Gamefolio became Squirrelcade (0.35.0, D99): copies added in the app are marked as Squirrelcade's.
UPDATE `copies` SET `source` = 'squirrelcade' WHERE `source` = 'gamefolio';
