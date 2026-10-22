/*
  04_queries.sql
  Полезные запросы для проверки базы и для скриншотов в отчёт.
  Выполняйте по одному: выделите запрос мышкой и нажмите F5.
*/
USE WeatherDb;
GO

-- 1. Все таблицы и количество строк в каждой
SELECT t.name AS TableName, SUM(p.rows) AS [RowCount]
FROM sys.tables AS t
JOIN sys.partitions AS p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
GROUP BY t.name
ORDER BY t.name;

-- 2. Все внешние ключи (связи между таблицами)
SELECT fk.name AS ForeignKey,
       OBJECT_NAME(fk.parent_object_id)     AS ChildTable,
       OBJECT_NAME(fk.referenced_object_id) AS ParentTable,
       fk.delete_referential_action_desc    AS OnDelete
FROM sys.foreign_keys AS fk
ORDER BY ChildTable;

-- 3. Пользователи (без хеша пароля)
SELECT UserId, Name, Email, CreatedAt, UpdatedAt FROM dbo.Users;

-- 4. Избранные города каждого пользователя
SELECT u.Name AS UserName, c.Name AS City, c.Country, f.AddedAt
FROM dbo.FavoriteCities AS f
JOIN dbo.Users  AS u ON u.UserId = f.UserId
JOIN dbo.Cities AS c ON c.CityId = f.CityId
ORDER BY u.Name, f.AddedAt;

-- 5. Последние 10 поисков
SELECT TOP (10) u.Email, c.Name AS City, h.SearchedAt
FROM dbo.SearchHistory AS h
JOIN dbo.Users  AS u ON u.UserId = h.UserId
JOIN dbo.Cities AS c ON c.CityId = h.CityId
ORDER BY h.SearchedAt DESC;

-- 6. Самые популярные города (по истории поиска)
SELECT c.Name, COUNT(*) AS Searches
FROM dbo.SearchHistory AS h
JOIN dbo.Cities AS c ON c.CityId = h.CityId
GROUP BY c.Name
ORDER BY Searches DESC;

-- 7. Последний замер погоды по каждому городу (представление)
SELECT * FROM dbo.vw_CityLatestWeather ORDER BY Name;

-- 8. Средняя температура по городам
SELECT c.Name, AVG(s.TempC) AS AvgTempC, MIN(s.TempC) AS MinTempC, MAX(s.TempC) AS MaxTempC, COUNT(*) AS Snapshots
FROM dbo.WeatherSnapshots AS s
JOIN dbo.Cities AS c ON c.CityId = s.CityId
GROUP BY c.Name;

-- 9. Активные сессии
SELECT s.SessionId, u.Email, s.CreatedAt, s.ExpiresAt
FROM dbo.Sessions AS s
JOIN dbo.Users AS u ON u.UserId = s.UserId
WHERE s.ExpiresAt > SYSUTCDATETIME();
