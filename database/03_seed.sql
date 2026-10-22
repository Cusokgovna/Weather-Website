/*
  03_seed.sql
  Тестовые данные, чтобы таблицы не были пустыми (для скриншотов и проверки).
  Демо-пользователь: demo@example.com / пароль demo1234
  (хеш scrypt сгенерирован сервером, сам пароль в БД не хранится).
  Скрипт идемпотентный: повторный запуск не создаёт дублей.
*/
USE WeatherDb;
GO

SET NOCOUNT ON;

/* ---------- Users ---------- */
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Email = N'demo@example.com')
    INSERT INTO dbo.Users (Name, Email, PasswordHash)
    VALUES (N'Demo User', N'demo@example.com',
            N'scrypt$e0daf5345b875e6b7cab1762bf920107$f621843a8ef15f17a56409a477232dbe0e1d2169f782a03b84ac6d1d3465156345121863d3fe358fb948e561ff51cba6141f18df192d98a9c28ee25394dc124d');

DECLARE @demoId INT = (SELECT UserId FROM dbo.Users WHERE Email = N'demo@example.com');

/* ---------- UserSettings ---------- */
IF NOT EXISTS (SELECT 1 FROM dbo.UserSettings WHERE UserId = @demoId)
    INSERT INTO dbo.UserSettings (UserId, Theme, Units, Language)
    VALUES (@demoId, N'dark', N'metric', N'en');

/* ---------- Cities ---------- */
DECLARE @cities TABLE (Name NVARCHAR(150), Country NVARCHAR(2), State NVARCHAR(150), Latitude DECIMAL(8,4), Longitude DECIMAL(8,4));
INSERT INTO @cities VALUES
    (N'Novosibirsk',      N'RU', N'Novosibirsk Oblast', 55.0282, 82.9235),
    (N'Moscow',           N'RU', N'Moscow',             55.7504, 37.6175),
    (N'Saint Petersburg', N'RU', N'Saint Petersburg',   59.9387, 30.3162),
    (N'Almaty',           N'KZ', NULL,                  43.2364, 76.9457),
    (N'Astana',           N'KZ', NULL,                  51.1282, 71.4307);

INSERT INTO dbo.Cities (Name, Country, State, Latitude, Longitude)
SELECT c.Name, c.Country, c.State, c.Latitude, c.Longitude
FROM @cities AS c
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.Cities AS x WHERE x.Latitude = c.Latitude AND x.Longitude = c.Longitude
);

DECLARE @nsk INT = (SELECT CityId FROM dbo.Cities WHERE Latitude = 55.0282 AND Longitude = 82.9235);
DECLARE @msk INT = (SELECT CityId FROM dbo.Cities WHERE Latitude = 55.7504 AND Longitude = 37.6175);
DECLARE @ala INT = (SELECT CityId FROM dbo.Cities WHERE Latitude = 43.2364 AND Longitude = 76.9457);

/* ---------- FavoriteCities ---------- */
INSERT INTO dbo.FavoriteCities (UserId, CityId)
SELECT @demoId, v.CityId
FROM (VALUES (@nsk), (@msk)) AS v (CityId)
WHERE NOT EXISTS (SELECT 1 FROM dbo.FavoriteCities f WHERE f.UserId = @demoId AND f.CityId = v.CityId);

/* ---------- SearchHistory ---------- */
IF NOT EXISTS (SELECT 1 FROM dbo.SearchHistory WHERE UserId = @demoId)
    INSERT INTO dbo.SearchHistory (UserId, CityId, SearchedAt) VALUES
        (@demoId, @nsk, DATEADD(HOUR, -5, SYSUTCDATETIME())),
        (@demoId, @msk, DATEADD(HOUR, -3, SYSUTCDATETIME())),
        (@demoId, @ala, DATEADD(HOUR, -1, SYSUTCDATETIME()));

/* ---------- WeatherSnapshots ---------- */
IF NOT EXISTS (SELECT 1 FROM dbo.WeatherSnapshots)
    INSERT INTO dbo.WeatherSnapshots (CityId, ObservedAt, TempC, FeelsLikeC, Humidity, PressureHPa, WindSpeedMs, Description, Icon) VALUES
        (@nsk, DATEADD(HOUR, -5, SYSUTCDATETIME()), -3.50, -8.10, 78, 1021, 4.20, N'light snow',       N'13d'),
        (@nsk, DATEADD(HOUR, -1, SYSUTCDATETIME()), -1.20, -5.60, 71, 1019, 3.10, N'overcast clouds',  N'04d'),
        (@msk, DATEADD(HOUR, -3, SYSUTCDATETIME()),  4.80,  1.90, 83, 1012, 5.40, N'light rain',       N'10d'),
        (@ala, DATEADD(HOUR, -1, SYSUTCDATETIME()), 12.30, 11.10, 45, 1016, 2.00, N'clear sky',        N'01d');
GO
