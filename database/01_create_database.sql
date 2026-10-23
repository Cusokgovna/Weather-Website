/*
  01_create_database.sql
  Создаёт базу данных KrakenShop (биржа игровых ценностей).
  Запускать в SSMS (File → Open → File → F5) или через `npm run db:init`.
  Скрипт идемпотентный: повторный запуск ничего не сломает.
*/
USE master;
GO

IF DB_ID(N'KrakenShop') IS NULL
BEGIN
    CREATE DATABASE KrakenShop COLLATE Cyrillic_General_CI_AS;
END
GO
