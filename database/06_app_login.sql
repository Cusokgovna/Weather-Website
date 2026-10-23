/*
  06_app_login.sql  (рекомендуется)
  Отдельный SQL-логин для сайта с минимальными правами, чтобы приложение
  не подключалось под администратором sa.

  ПЕРЕД ЗАПУСКОМ замените <ПРИДУМАЙТЕ_ПАРОЛЬ> на свой пароль
  (минимум 8 символов: большие и маленькие буквы, цифры, спецсимвол).
  Этот же пароль запишите в .env (DB_PASSWORD). Файл с паролем НЕ сохраняйте и не коммитьте.
*/
USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'kraken_app')
    CREATE LOGIN kraken_app WITH PASSWORD = N'<ПРИДУМАЙТЕ_ПАРОЛЬ>', CHECK_POLICY = ON;
GO

USE KrakenShop;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'kraken_app')
    CREATE USER kraken_app FOR LOGIN kraken_app;
GO

-- Чтение и запись данных + запуск хранимых процедур; менять структуру таблиц нельзя
ALTER ROLE db_datareader ADD MEMBER kraken_app;
ALTER ROLE db_datawriter ADD MEMBER kraken_app;
GRANT EXECUTE ON SCHEMA::dbo TO kraken_app;
GO
