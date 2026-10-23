/*
  04_seed.sql
  Тестовые данные: игры, разделы, продавцы, лоты, сделки, отзывы, чат, кошелёк.

  Демо-аккаунты (у всех пароль demo1234, в БД лежит только хеш scrypt):
    demo@example.com    — покупатель, на балансе 4 760 ₽, есть 2 сделки
    kraken@example.com  — продавец KrakenTrader
    skins@example.com   — продавец SkinMaster
    night@example.com   — продавец NightMarket

  Скрипт идемпотентный: игры и разделы добавляются, если их нет;
  пользователи, лоты и сделки — только в пустую базу.
*/
USE KrakenShop;
GO

SET NOCOUNT ON;

/* ---------- Games ---------- */
DECLARE @games TABLE (Name NVARCHAR(100), Slug VARCHAR(50), Description NVARCHAR(500), SortOrder INT);
INSERT INTO @games VALUES
    (N'Counter-Strike 2',  'cs2',     N'Скины, кейсы и Prime-аккаунты CS2',                   1),
    (N'Dota 2',            'dota2',   N'Предметы, арканы, аккаунты и буст MMR',               2),
    (N'Genshin Impact',    'genshin', N'Аккаунты и кристаллы Сотворения',                     3),
    (N'World of Warcraft', 'wow',     N'Золото и услуги на европейских серверах',             4),
    (N'Roblox',            'roblox',  N'Robux и редкие предметы',                             5),
    (N'Steam',             'steam',   N'Подарочные карты и ключи игр',                        6);

INSERT INTO dbo.Games (Name, Slug, Description, SortOrder)
SELECT g.Name, g.Slug, g.Description, g.SortOrder FROM @games g
WHERE NOT EXISTS (SELECT 1 FROM dbo.Games x WHERE x.Slug = g.Slug);

/* ---------- Categories ---------- */
DECLARE @cats TABLE (GameSlug VARCHAR(50), Name NVARCHAR(100), Slug VARCHAR(50), Kind VARCHAR(10));
INSERT INTO @cats VALUES
    ('cs2',     N'Скины',            'skins',    'item'),
    ('cs2',     N'Аккаунты',         'accounts', 'account'),
    ('dota2',   N'Предметы',         'items',    'item'),
    ('dota2',   N'Буст MMR',         'boosting', 'service'),
    ('genshin', N'Аккаунты',         'accounts', 'account'),
    ('genshin', N'Кристаллы',        'crystals', 'currency'),
    ('wow',     N'Золото',           'gold',     'currency'),
    ('wow',     N'Услуги',           'services', 'service'),
    ('roblox',  N'Robux',            'robux',    'currency'),
    ('roblox',  N'Предметы',         'items',    'item'),
    ('steam',   N'Пополнение',       'wallet',   'currency'),
    ('steam',   N'Ключи игр',        'keys',     'item');

INSERT INTO dbo.Categories (GameId, Name, Slug, Kind)
SELECT g.GameId, c.Name, c.Slug, c.Kind
FROM @cats c JOIN dbo.Games g ON g.Slug = c.GameSlug
WHERE NOT EXISTS (SELECT 1 FROM dbo.Categories x WHERE x.GameId = g.GameId AND x.Slug = c.Slug);
GO

/* ---------- Users, Listings, Orders ... (только в пустую базу) ---------- */
IF NOT EXISTS (SELECT 1 FROM dbo.Users)
BEGIN
    DECLARE @hash NVARCHAR(255) = N'scrypt$e0daf5345b875e6b7cab1762bf920107$f621843a8ef15f17a56409a477232dbe0e1d2169f782a03b84ac6d1d3465156345121863d3fe358fb948e561ff51cba6141f18df192d98a9c28ee25394dc124d';

    INSERT INTO dbo.Users (Username, Email, PasswordHash, Balance, CreatedAt) VALUES
        (N'demo',         N'demo@example.com',   @hash, 4760.00, DATEADD(DAY, -10,  SYSUTCDATETIME())),
        (N'KrakenTrader', N'kraken@example.com', @hash, 1250.00, DATEADD(DAY, -400, SYSUTCDATETIME())),
        (N'SkinMaster',   N'skins@example.com',  @hash,    0.00, DATEADD(DAY, -210, SYSUTCDATETIME())),
        (N'NightMarket',  N'night@example.com',  @hash,    0.00, DATEADD(DAY, -95,  SYSUTCDATETIME()));

    DECLARE @demo   INT = (SELECT UserId FROM dbo.Users WHERE Username = N'demo');
    DECLARE @kraken INT = (SELECT UserId FROM dbo.Users WHERE Username = N'KrakenTrader');
    DECLARE @skins  INT = (SELECT UserId FROM dbo.Users WHERE Username = N'SkinMaster');
    DECLARE @night  INT = (SELECT UserId FROM dbo.Users WHERE Username = N'NightMarket');

    -- CategoryId по паре "игра/раздел"
    DECLARE @c TABLE (Code VARCHAR(40), CategoryId INT);
    INSERT INTO @c SELECT g.Slug + '/' + c.Slug, c.CategoryId FROM dbo.Categories c JOIN dbo.Games g ON g.GameId = c.GameId;

    INSERT INTO dbo.Listings (SellerId, CategoryId, Title, Description, Price, Quantity, Status, CreatedAt)
    SELECT v.SellerId, c.CategoryId, v.Title, v.Description, v.Price, v.Quantity, v.Status, DATEADD(HOUR, -v.AgeHours, SYSUTCDATETIME())
    FROM (VALUES
        (@kraken, 'cs2/skins',       N'AK-47 | Redline (Field-Tested)',               N'Передача через трейд Steam сразу после оплаты. Float 0.21.',          1250.00,  3, 'active', 72),
        (@skins,  'cs2/skins',       N'AWP | Asiimov (Battle-Scarred)',               N'Без наклеек. Передача в течение 15 минут.',                           7490.00,  1, 'active', 50),
        (@skins,  'cs2/skins',       N'Karambit | Doppler Phase 2 (Factory New)',     N'Редкая фаза, float 0.008. Только через гарант сайта.',               89990.00, 1, 'active', 30),
        (@night,  'cs2/accounts',    N'Prime-аккаунт, 1500 часов, 12 медалей',        N'Родная почта в комплекте, без VAC-банов.',                            2490.00,  2, 'active', 120),
        (@kraken, 'dota2/items',     N'Arcana Terrorblade — Fractal Horns',           N'Передача через трейд, аккаунт без ограничений.',                      2190.00,  5, 'active', 26),
        (@night,  'dota2/boosting',  N'Буст MMR +1000 (Legend → Ancient)',            N'Играет игрок 8000 MMR, срок 3–5 дней, без использования читов.',      3500.00, 10, 'active', 200),
        (@night,  'genshin/accounts',N'AR 58, Raiden + Nahida C2, 40 пятизвёздочных', N'Привязка к почте, смена данных после покупки.',                        3990.00,  0, 'sold',   90),
        (@kraken, 'genshin/crystals',N'6480 кристаллов Сотворения (по UID)',          N'Пополнение по UID, без входа в аккаунт. 5–10 минут.',                 6990.00, 50, 'active', 15),
        (@skins,  'wow/gold',        N'100 000 золота — EU Gordunni (Орда)',          N'Передача через аукцион или почту, указывайте ник.',                    590.00, 30, 'active', 8),
        (@kraken, 'roblox/robux',    N'1000 Robux (выплата через группу)',            N'Нужно состоять в группе 14 дней. Начисление моментально.',             990.00,100, 'active', 5),
        (@night,  'steam/wallet',    N'Пополнение Steam 1000 ₽ (код)',                N'Код подарочной карты, регион RU/CIS.',                                1090.00, 20, 'active', 3),
        (@skins,  'roblox/items',    N'Adopt Me — Neon Shadow Dragon',                N'Передача в игре, договоримся о времени в чате сделки.',               4500.00,  1, 'active', 60)
    ) AS v (SellerId, Code, Title, Description, Price, Quantity, Status, AgeHours)
    JOIN @c c ON c.Code = v.Code;

    DECLARE @redline INT = (SELECT ListingId FROM dbo.Listings WHERE Title LIKE N'AK-47 | Redline%');
    DECLARE @genshin INT = (SELECT ListingId FROM dbo.Listings WHERE Title LIKE N'AR 58%');

    /* Сделка 1: завершена, с отзывом. Сделка 2: оплачена, идёт переписка */
    INSERT INTO dbo.Orders (ListingId, BuyerId, SellerId, Quantity, UnitPrice, Status, CreatedAt, ClosedAt) VALUES
        (@redline, @demo, @kraken, 1, 1250.00, 'completed', DATEADD(DAY, -5, SYSUTCDATETIME()), DATEADD(MINUTE, 7, DATEADD(DAY, -5, SYSUTCDATETIME()))),
        (@genshin, @demo, @night,  1, 3990.00, 'paid',      DATEADD(HOUR, -2, SYSUTCDATETIME()), NULL);

    DECLARE @o1 INT = (SELECT OrderId FROM dbo.Orders WHERE ListingId = @redline);
    DECLARE @o2 INT = (SELECT OrderId FROM dbo.Orders WHERE ListingId = @genshin);

    INSERT INTO dbo.Transactions (UserId, OrderId, Amount, Type, BalanceAfter, CreatedAt) VALUES
        (@demo,   NULL, 10000.00, 'deposit',  10000.00, DATEADD(DAY, -6, SYSUTCDATETIME())),
        (@demo,   @o1,  -1250.00, 'purchase',  8750.00, DATEADD(DAY, -5, SYSUTCDATETIME())),
        (@kraken, @o1,   1250.00, 'sale',      1250.00, DATEADD(MINUTE, 7, DATEADD(DAY, -5, SYSUTCDATETIME()))),
        (@demo,   @o2,  -3990.00, 'purchase',  4760.00, DATEADD(HOUR, -2, SYSUTCDATETIME()));

    INSERT INTO dbo.Reviews (OrderId, AuthorId, SellerId, Rating, Text, CreatedAt) VALUES
        (@o1, @demo, @kraken, 5, N'Трейд пришёл через 2 минуты, всё отлично!', DATEADD(MINUTE, 10, DATEADD(DAY, -5, SYSUTCDATETIME())));

    INSERT INTO dbo.Messages (OrderId, SenderId, Text, CreatedAt) VALUES
        (@o1, @kraken, N'Привет! Отправил трейд, проверь Steam.',              DATEADD(MINUTE, 2, DATEADD(DAY, -5, SYSUTCDATETIME()))),
        (@o1, @demo,   N'Принял, спасибо!',                                     DATEADD(MINUTE, 6, DATEADD(DAY, -5, SYSUTCDATETIME()))),
        (@o2, @night,  N'Здравствуйте! Данные от аккаунта отправлю в течение часа.', DATEADD(MINUTE, -110, SYSUTCDATETIME())),
        (@o2, @demo,   N'Хорошо, жду.',                                         DATEADD(MINUTE, -100, SYSUTCDATETIME()));
END
GO
