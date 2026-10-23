/*
  05_queries.sql
  Запросы для проверки базы и для скриншотов в отчёт.
  Выделите один запрос мышкой и нажмите F5.
*/
USE KrakenShop;
GO

-- 1. Все таблицы и количество строк
SELECT t.name AS TableName, SUM(p.rows) AS [RowCount]
FROM sys.tables AS t
JOIN sys.partitions AS p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
GROUP BY t.name
ORDER BY t.name;

-- 2. Все внешние ключи (связи)
SELECT fk.name AS ForeignKey,
       OBJECT_NAME(fk.parent_object_id)     AS ChildTable,
       OBJECT_NAME(fk.referenced_object_id) AS ParentTable,
       fk.delete_referential_action_desc    AS OnDelete
FROM sys.foreign_keys AS fk
ORDER BY ChildTable;

-- 3. Каталог: активные лоты с игрой, разделом и продавцом, от дешёвых к дорогим
SELECT g.Name AS Game, c.Name AS Category, l.Title, l.Price, l.Quantity, u.Username AS Seller
FROM dbo.Listings AS l
JOIN dbo.Categories AS c ON c.CategoryId = l.CategoryId
JOIN dbo.Games      AS g ON g.GameId = c.GameId
JOIN dbo.Users      AS u ON u.UserId = l.SellerId
WHERE l.Status = 'active'
ORDER BY g.SortOrder, l.Price;

-- 4. Количество активных лотов и минимальная цена по каждой игре и сервису
SELECT g.Name, COUNT(l.ListingId) AS ActiveListings, MIN(l.Price) AS MinPrice
FROM dbo.Games AS g
LEFT JOIN dbo.Categories AS c ON c.GameId = g.GameId
LEFT JOIN dbo.Listings   AS l ON l.CategoryId = c.CategoryId AND l.Status = 'active'
GROUP BY g.Name, g.SortOrder
ORDER BY g.SortOrder;

-- 5. Рейтинг продавцов (представление)
SELECT * FROM dbo.vw_SellerStats ORDER BY SalesCount DESC, AvgRating DESC;

-- 6. Все сделки с покупателем, продавцом и суммой
SELECT o.OrderId, l.Title, b.Username AS Buyer, s.Username AS Seller, o.Quantity, o.TotalPrice, o.Status, o.CreatedAt
FROM dbo.Orders AS o
JOIN dbo.Listings AS l ON l.ListingId = o.ListingId
JOIN dbo.Users    AS b ON b.UserId = o.BuyerId
JOIN dbo.Users    AS s ON s.UserId = o.SellerId
ORDER BY o.CreatedAt DESC;

-- 7. История кошелька пользователя demo
SELECT t.CreatedAt, t.Type, t.Amount, t.BalanceAfter, t.OrderId
FROM dbo.Transactions AS t
JOIN dbo.Users AS u ON u.UserId = t.UserId
WHERE u.Username = N'demo'
ORDER BY t.TransactionId;

-- 8. Проверка целостности: баланс = сумма всех операций по кошельку (должно вернуть 0 строк)
SELECT u.Username, u.Balance, ISNULL(SUM(t.Amount), 0) AS LedgerSum
FROM dbo.Users AS u
LEFT JOIN dbo.Transactions AS t ON t.UserId = u.UserId
GROUP BY u.Username, u.Balance
HAVING u.Balance <> ISNULL(SUM(t.Amount), 0);

-- 9. Все чаты: лот, покупатель, продавец, число сообщений, вызывали ли поддержку
SELECT c.ConversationId, l.Title, b.Username AS Buyer, s.Username AS Seller,
       (SELECT COUNT(*) FROM dbo.Messages m WHERE m.ConversationId = c.ConversationId) AS Messages,
       c.SupportRequestedAt, c.LastMessageAt
FROM dbo.Conversations AS c
JOIN dbo.Listings AS l ON l.ListingId = c.ListingId
JOIN dbo.Users    AS b ON b.UserId = c.BuyerId
JOIN dbo.Users    AS s ON s.UserId = c.SellerId
ORDER BY c.LastMessageAt DESC;

-- 10. Переписка в чате №2 (SenderId NULL = системное сообщение)
SELECT m.CreatedAt, ISNULL(u.Username, N'[system]') AS Sender, m.Text
FROM dbo.Messages AS m LEFT JOIN dbo.Users AS u ON u.UserId = m.SenderId
WHERE m.ConversationId = 2
ORDER BY m.MessageId;

-- 11. Новости и курсы валют
SELECT NewsId, Title, PublishedAt FROM dbo.News ORDER BY PublishedAt DESC;
SELECT * FROM dbo.ExchangeRates;

-- 12. Пример вызова процедуры покупки (раскомментируйте, чтобы увидеть ошибку "You cannot buy your own offer")
-- EXEC dbo.usp_CreateOrder @BuyerId = 2, @ListingId = 1, @Quantity = 1;
