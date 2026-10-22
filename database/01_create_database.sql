/*
  01_create_database.sql
  Создаёт базу данных WeatherDb.
  Запускать в SSMS (New Query → F5) или через `npm run db:init`.
  Скрипт идемпотентный: повторный запуск ничего не сломает.
*/
USE master;
GO

IF DB_ID(N'WeatherDb') IS NULL
BEGIN
    CREATE DATABASE WeatherDb COLLATE Cyrillic_General_CI_AS;
END
GO
