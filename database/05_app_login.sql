/*
  05_app_login.sql  (необязательно, но рекомендуется)
  Создаёт отдельный SQL-логин для сайта с минимальными правами,
  чтобы приложение не подключалось под администратором sa.

  ПЕРЕД ЗАПУСКОМ замените <ПРИДУМАЙТЕ_ПАРОЛЬ> на свой пароль
  (минимум 8 символов: большие и маленькие буквы, цифры, спецсимвол).
  Этот же пароль запишите в файл .env (DB_PASSWORD) — и НИКОГДА не коммитьте его в Git.
*/
USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'weather_app')
    CREATE LOGIN weather_app WITH PASSWORD = N'<ПРИДУМАЙТЕ_ПАРОЛЬ>', CHECK_POLICY = ON;
GO

USE WeatherDb;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'weather_app')
    CREATE USER weather_app FOR LOGIN weather_app;
GO

-- Только чтение и запись данных, без права менять структуру таблиц
ALTER ROLE db_datareader ADD MEMBER weather_app;
ALTER ROLE db_datawriter ADD MEMBER weather_app;
GO
