/*
  04_seed.sql
  Тестовые данные: игры и сервисы из левого меню макета, разделы, продавцы, лоты,
  чаты, сделки, отзыв, новости, курсы валют.

  Демо-аккаунты (у всех пароль demo1234, в БД лежит только хеш scrypt):
    demo@example.com    — покупатель demo, баланс 6 860 ₽, есть сделки и чаты
    kraken@example.com  — продавец KrakenTrader
    skins@example.com   — продавец SkinMaster
    night@example.com   — продавец NightMarket (с возвратом → отрицательный Social credit)
    team@example.com    — KrakenTeam, автор новостей

  Скрипт идемпотентный: игры, разделы и курсы добавляются, если их нет;
  пользователи, лоты, сделки и новости — только в пустую базу.
*/
USE KrakenShop;
GO

-- Нужны для вычисляемого столбца Orders.TotalPrice (в SSMS включены по умолчанию, в sqlcmd — нет)
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

SET NOCOUNT ON;

/* ---------- Games (порядок как в левом меню) ---------- */
DECLARE @games TABLE (Name NVARCHAR(100), Slug VARCHAR(50), Section VARCHAR(10), Description NVARCHAR(500), SortOrder INT);
INSERT INTO @games VALUES
    (N'Dota 2',          'dota2',          'game',    N'Items, arcanas, accounts and MMR boosting',        1),
    (N'Rust',            'rust',           'game',    N'Skins and accounts',                                2),
    (N'EFT (Tarkov)',    'eft',            'game',    N'Roubles, loot and accounts for Escape from Tarkov', 3),
    (N'Arena Breakout',  'arena-breakout', 'game',    N'Koens, items and accounts',                         4),
    (N'Stalzone',        'stalzone',       'game',    N'In-game items for cheap',                           5),
    (N'LoL',             'lol',            'game',    N'League of Legends accounts, RP and boosting',       6),
    (N'War Thunder',     'war-thunder',    'game',    N'Golden Eagles, vehicles and accounts',              7),
    (N'Roblox',          'roblox',         'game',    N'Robux and rare items',                              8),
    (N'Clash Royale',    'clash-royale',   'game',    N'Gems and accounts',                                 9),
    (N'Brawl Stars',     'brawl-stars',    'game',    N'Gems and accounts',                                 10),
    (N'Arma 3',          'arma-3',         'game',    N'Keys and accounts',                                 11),
    (N'Squad',           'squad',          'game',    N'Keys and accounts',                                 12),
    (N'DayZ',            'dayz',           'game',    N'Keys, accounts and services',                       13),
    (N'Steam',           'steam',          'game',    N'Wallet top-ups, game keys and accounts',            14),
    (N'CS 2',            'cs2',            'game',    N'Skins, cases and Prime accounts',                   15),
    (N'Fortnite',        'fortnite',       'game',    N'V-Bucks and accounts',                              16),
    (N'Gift Cards',      'gift-cards',     'service', N'Gift cards for Steam, PlayStation, Xbox and App Store', 101),
    (N'Special apps',    'special-apps',   'service', N'Subscriptions: Discord Nitro, Spotify, Telegram Premium', 102);

INSERT INTO dbo.Games (Name, Slug, Section, Description, SortOrder)
SELECT g.Name, g.Slug, g.Section, g.Description, g.SortOrder FROM @games g
WHERE NOT EXISTS (SELECT 1 FROM dbo.Games x WHERE x.Slug = g.Slug);

/* ---------- Categories ---------- */
DECLARE @cats TABLE (GameSlug VARCHAR(50), Name NVARCHAR(100), Slug VARCHAR(50), Kind VARCHAR(10));
INSERT INTO @cats VALUES
    ('dota2', N'Items', 'items', 'item'), ('dota2', N'Accounts', 'accounts', 'account'), ('dota2', N'Boosting', 'boosting', 'service'),
    ('rust', N'Skins', 'skins', 'item'), ('rust', N'Accounts', 'accounts', 'account'),
    ('eft', N'Roubles', 'roubles', 'currency'), ('eft', N'Items', 'items', 'item'), ('eft', N'Accounts', 'accounts', 'account'),
    ('arena-breakout', N'Koens', 'koens', 'currency'), ('arena-breakout', N'Items', 'items', 'item'), ('arena-breakout', N'Accounts', 'accounts', 'account'),
    ('stalzone', N'Items', 'items', 'item'), ('stalzone', N'Currency', 'currency', 'currency'), ('stalzone', N'Accounts', 'accounts', 'account'),
    ('lol', N'Accounts', 'accounts', 'account'), ('lol', N'Boosting', 'boosting', 'service'), ('lol', N'RP', 'rp', 'currency'),
    ('war-thunder', N'Golden Eagles', 'golden-eagles', 'currency'), ('war-thunder', N'Vehicles', 'vehicles', 'item'), ('war-thunder', N'Accounts', 'accounts', 'account'),
    ('roblox', N'Robux', 'robux', 'currency'), ('roblox', N'Items', 'items', 'item'),
    ('clash-royale', N'Gems', 'gems', 'currency'), ('clash-royale', N'Accounts', 'accounts', 'account'),
    ('brawl-stars', N'Gems', 'gems', 'currency'), ('brawl-stars', N'Accounts', 'accounts', 'account'),
    ('arma-3', N'Keys', 'keys', 'item'), ('arma-3', N'Accounts', 'accounts', 'account'),
    ('squad', N'Keys', 'keys', 'item'), ('squad', N'Accounts', 'accounts', 'account'),
    ('dayz', N'Keys', 'keys', 'item'), ('dayz', N'Accounts', 'accounts', 'account'), ('dayz', N'Services', 'services', 'service'),
    ('steam', N'Wallet', 'wallet', 'currency'), ('steam', N'Keys', 'keys', 'item'), ('steam', N'Accounts', 'accounts', 'account'),
    ('cs2', N'Skins', 'skins', 'item'), ('cs2', N'Accounts', 'accounts', 'account'), ('cs2', N'Cases', 'cases', 'item'),
    ('fortnite', N'V-Bucks', 'v-bucks', 'currency'), ('fortnite', N'Accounts', 'accounts', 'account'),
    ('gift-cards', N'Steam', 'steam', 'giftcard'), ('gift-cards', N'PlayStation', 'playstation', 'giftcard'),
    ('gift-cards', N'Xbox', 'xbox', 'giftcard'), ('gift-cards', N'App Store', 'app-store', 'giftcard'),
    ('special-apps', N'Discord Nitro', 'discord-nitro', 'app'), ('special-apps', N'Spotify', 'spotify', 'app'),
    ('special-apps', N'Telegram Premium', 'telegram-premium', 'app');

INSERT INTO dbo.Categories (GameId, Name, Slug, Kind)
SELECT g.GameId, c.Name, c.Slug, c.Kind
FROM @cats c JOIN dbo.Games g ON g.Slug = c.GameSlug
WHERE NOT EXISTS (SELECT 1 FROM dbo.Categories x WHERE x.GameId = g.GameId AND x.Slug = c.Slug);

/* ---------- ExchangeRates (сервер обновляет их с сайта ЦБ РФ раз в 12 часов) ---------- */
INSERT INTO dbo.ExchangeRates (CurrencyCode, RateRub, UpdatedAt)
SELECT v.Code, v.Rate, '2025-01-01'
FROM (VALUES ('USD', 81.6350), ('EUR', 95.9299)) AS v (Code, Rate)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ExchangeRates x WHERE x.CurrencyCode = v.Code);
GO

/* ---------- Users, Listings, Conversations, Orders, News (только в пустую базу) ---------- */
IF NOT EXISTS (SELECT 1 FROM dbo.Users)
BEGIN
    DECLARE @hash NVARCHAR(255) = N'scrypt$e0daf5345b875e6b7cab1762bf920107$f621843a8ef15f17a56409a477232dbe0e1d2169f782a03b84ac6d1d3465156345121863d3fe358fb948e561ff51cba6141f18df192d98a9c28ee25394dc124d';

    INSERT INTO dbo.Users (Username, Email, PasswordHash, RealName, Balance, CreatedAt) VALUES
        (N'demo',         N'demo@example.com',   @hash, N'Demo Buyer',   6860.00, DATEADD(DAY, -10,  SYSUTCDATETIME())),
        (N'KrakenTrader', N'kraken@example.com', @hash, N'Alex Kraken',  6250.00, DATEADD(DAY, -400, SYSUTCDATETIME())),
        (N'SkinMaster',   N'skins@example.com',  @hash, NULL,               0.00, DATEADD(DAY, -210, SYSUTCDATETIME())),
        (N'NightMarket',  N'night@example.com',  @hash, NULL,               0.00, DATEADD(DAY, -95,  SYSUTCDATETIME())),
        (N'KrakenTeam',   N'team@example.com',   @hash, N'Kraken Shop',     0.00, DATEADD(DAY, -500, SYSUTCDATETIME()));

    DECLARE @demo   INT = (SELECT UserId FROM dbo.Users WHERE Username = N'demo');
    DECLARE @kraken INT = (SELECT UserId FROM dbo.Users WHERE Username = N'KrakenTrader');
    DECLARE @skins  INT = (SELECT UserId FROM dbo.Users WHERE Username = N'SkinMaster');
    DECLARE @night  INT = (SELECT UserId FROM dbo.Users WHERE Username = N'NightMarket');
    DECLARE @team   INT = (SELECT UserId FROM dbo.Users WHERE Username = N'KrakenTeam');

    -- CategoryId по паре "игра/раздел"
    DECLARE @c TABLE (Code VARCHAR(80), CategoryId INT);
    INSERT INTO @c SELECT g.Slug + '/' + c.Slug, c.CategoryId FROM dbo.Categories c JOIN dbo.Games g ON g.GameId = c.GameId;

    INSERT INTO dbo.Listings (SellerId, CategoryId, Title, Description, Price, Quantity, CreatedAt)
    SELECT v.SellerId, c.CategoryId, v.Title, v.Description, v.Price, v.Quantity, DATEADD(HOUR, -v.AgeHours, SYSUTCDATETIME())
    FROM (VALUES
        (@kraken, 'stalzone/items',          N'Gauss Gun — Legendary',                    N'Gauss gun with max upgrades. Delivery in game after payment, 5–15 minutes. The quantity is limited, buy now!', 24490.00,   3, 1),
        (@skins,  'stalzone/items',          N'Gauss Gun — Epic',                         N'Epic Gauss gun, no wear. Meet in the safe zone, trade within 10 minutes.',                                    12990.00,   5, 2),
        (@night,  'stalzone/items',          N'Gauss Gun — Rare (+2 upgrade)',            N'Rare Gauss gun with +2 upgrade. Online every evening.',                                                         6990.00,   8, 4),
        (@kraken, 'cs2/skins',               N'AK-47 | Redline (Field-Tested)',           N'Steam trade right after payment. Float 0.21.',                                                                  1250.00,   3, 72),
        (@skins,  'cs2/skins',               N'AWP | Asiimov (Battle-Scarred)',           N'No stickers. Trade within 15 minutes.',                                                                         7490.00,   1, 50),
        (@skins,  'cs2/skins',               N'Karambit | Doppler Phase 2 (Factory New)', N'Rare phase, float 0.008. Escrow only.',                                                                        89990.00,   1, 30),
        (@night,  'cs2/accounts',            N'Prime account, 1500 hours, 12 medals',     N'Original email included, no VAC bans.',                                                                         2490.00,   2, 120),
        (@kraken, 'dota2/items',             N'Arcana Terrorblade — Fractal Horns',       N'Steam trade, account without restrictions.',                                                                    2190.00,   5, 26),
        (@night,  'dota2/boosting',          N'MMR boost +1000 (Legend → Ancient)',       N'Played by an 8000 MMR player, 3–5 days, no cheats.',                                                            3500.00,  10, 200),
        (@night,  'eft/roubles',             N'10 000 000 roubles (EU servers)',          N'Transfer via the flea market. Tell your nickname in the chat.',                                                1890.00,  19, 60),
        (@kraken, 'eft/items',               N'LEDX Skin Transilluminator ×3',            N'Three LEDX in one raid on Factory.',                                                                            5900.00,   4, 33),
        (@skins,  'rust/skins',              N'Tempered AK-47',                           N'Steam trade, instant.',                                                                                         4200.00,   1, 80),
        (@night,  'lol/boosting',            N'Rank boost: Silver → Gold',                N'Duo or solo, 2–4 days.',                                                                                        2900.00,   5, 90),
        (@skins,  'war-thunder/golden-eagles', N'2500 Golden Eagles',                     N'Code for the official store.',                                                                                  1490.00,  15, 18),
        (@kraken, 'roblox/robux',            N'1000 Robux (group payout)',                N'You must be in the group for 14 days. Instant payout.',                                                          990.00, 100, 5),
        (@kraken, 'fortnite/v-bucks',        N'2800 V-Bucks (account top-up)',            N'Top-up through Epic Games login, 10 minutes.',                                                                  1690.00,  30, 12),
        (@night,  'gift-cards/steam',        N'Steam Wallet card 1000 RUB',               N'Gift card code, RU/CIS region.',                                                                                1090.00,  20, 3),
        (@kraken, 'special-apps/discord-nitro', N'Discord Nitro — 1 month',               N'Gift link, works for any account.',                                                                              590.00,  50, 7)
    ) AS v (SellerId, Code, Title, Description, Price, Quantity, AgeHours)
    JOIN @c c ON c.Code = v.Code;

    DECLARE @redline INT = (SELECT ListingId FROM dbo.Listings WHERE Title LIKE N'AK-47 | Redline%');
    DECLARE @roubles INT = (SELECT ListingId FROM dbo.Listings WHERE Title LIKE N'10 000 000 roubles%');
    DECLARE @steam   INT = (SELECT ListingId FROM dbo.Listings WHERE Title LIKE N'Steam Wallet card%');
    DECLARE @gauss   INT = (SELECT ListingId FROM dbo.Listings WHERE Title = N'Gauss Gun — Legendary');

    /* Чаты: 3 со сделками + 1 вопрос до покупки (кнопка TO CHAT) */
    INSERT INTO dbo.Conversations (ListingId, BuyerId, SellerId, CreatedAt, LastMessageAt, SupportRequestedAt) VALUES
        (@redline, @demo,   @kraken, DATEADD(DAY, -5, SYSUTCDATETIME()),     DATEADD(MINUTE, 7, DATEADD(DAY, -5, SYSUTCDATETIME())), NULL),
        (@roubles, @demo,   @night,  DATEADD(HOUR, -2, SYSUTCDATETIME()),    DATEADD(MINUTE, -100, SYSUTCDATETIME()),                NULL),
        (@steam,   @kraken, @night,  DATEADD(DAY, -3, SYSUTCDATETIME()),     DATEADD(DAY, -2, SYSUTCDATETIME()),                      DATEADD(DAY, -3, DATEADD(HOUR, 5, SYSUTCDATETIME()))),
        (@gauss,   @demo,   @kraken, DATEADD(MINUTE, -30, SYSUTCDATETIME()), DATEADD(MINUTE, -25, SYSUTCDATETIME()),                 NULL);

    DECLARE @c1 INT = (SELECT ConversationId FROM dbo.Conversations WHERE ListingId = @redline AND BuyerId = @demo);
    DECLARE @c2 INT = (SELECT ConversationId FROM dbo.Conversations WHERE ListingId = @roubles AND BuyerId = @demo);
    DECLARE @c3 INT = (SELECT ConversationId FROM dbo.Conversations WHERE ListingId = @steam   AND BuyerId = @kraken);
    DECLARE @c4 INT = (SELECT ConversationId FROM dbo.Conversations WHERE ListingId = @gauss   AND BuyerId = @demo);

    /* Сделки: 1 — завершена с отзывом, 2 — оплачена (идёт передача), 3 — возврат */
    INSERT INTO dbo.Orders (ListingId, ConversationId, BuyerId, SellerId, Quantity, UnitPrice, Status, CreatedAt, ClosedAt) VALUES
        (@redline, @c1, @demo,   @kraken, 1, 1250.00, 'completed', DATEADD(DAY, -5, SYSUTCDATETIME()),  DATEADD(MINUTE, 7, DATEADD(DAY, -5, SYSUTCDATETIME()))),
        (@roubles, @c2, @demo,   @night,  1, 1890.00, 'paid',      DATEADD(HOUR, -2, SYSUTCDATETIME()), NULL),
        (@steam,   @c3, @kraken, @night,  1, 1090.00, 'refunded',  DATEADD(DAY, -3, SYSUTCDATETIME()),  DATEADD(DAY, -2, SYSUTCDATETIME()));

    DECLARE @o1 INT = (SELECT OrderId FROM dbo.Orders WHERE ConversationId = @c1);
    DECLARE @o2 INT = (SELECT OrderId FROM dbo.Orders WHERE ConversationId = @c2);
    DECLARE @o3 INT = (SELECT OrderId FROM dbo.Orders WHERE ConversationId = @c3);

    INSERT INTO dbo.Transactions (UserId, OrderId, Amount, Type, BalanceAfter, CreatedAt) VALUES
        (@demo,   NULL, 10000.00, 'deposit',  10000.00, DATEADD(DAY, -6, SYSUTCDATETIME())),
        (@demo,   @o1,  -1250.00, 'purchase',  8750.00, DATEADD(DAY, -5, SYSUTCDATETIME())),
        (@kraken, @o1,   1250.00, 'sale',      1250.00, DATEADD(MINUTE, 7, DATEADD(DAY, -5, SYSUTCDATETIME()))),
        (@kraken, NULL,  5000.00, 'deposit',   6250.00, DATEADD(DAY, -4, SYSUTCDATETIME())),
        (@kraken, @o3,  -1090.00, 'purchase',  5160.00, DATEADD(DAY, -3, SYSUTCDATETIME())),
        (@kraken, @o3,   1090.00, 'refund',    6250.00, DATEADD(DAY, -2, SYSUTCDATETIME())),
        (@demo,   @o2,  -1890.00, 'purchase',  6860.00, DATEADD(HOUR, -2, SYSUTCDATETIME()));

    INSERT INTO dbo.Reviews (OrderId, AuthorId, SellerId, Rating, Text, CreatedAt) VALUES
        (@o1, @demo, @kraken, 5, N'Trade offer came in 2 minutes. Recommend!', DATEADD(MINUTE, 10, DATEADD(DAY, -5, SYSUTCDATETIME())));

    INSERT INTO dbo.Messages (ConversationId, SenderId, Text, CreatedAt) VALUES
        (@c1, NULL,    CONCAT(N'Order #', @o1, N' paid: 1 × AK-47 | Redline (Field-Tested) for 1,250.00 RUB. The money is held by Kraken Shop until the buyer confirms delivery.'), DATEADD(DAY, -5, SYSUTCDATETIME())),
        (@c1, @kraken, N'Hi! Trade offer sent, check Steam.',                       DATEADD(MINUTE, 2, DATEADD(DAY, -5, SYSUTCDATETIME()))),
        (@c1, @demo,   N'Accepted, thanks!',                                        DATEADD(MINUTE, 6, DATEADD(DAY, -5, SYSUTCDATETIME()))),
        (@c1, NULL,    CONCAT(N'Order #', @o1, N' completed. The money was sent to the seller.'), DATEADD(MINUTE, 7, DATEADD(DAY, -5, SYSUTCDATETIME()))),
        (@c2, NULL,    CONCAT(N'Order #', @o2, N' paid: 1 × 10 000 000 roubles (EU servers) for 1,890.00 RUB. The money is held by Kraken Shop until the buyer confirms delivery.'), DATEADD(HOUR, -2, SYSUTCDATETIME())),
        (@c2, @night,  N'Hello! What is your nickname in Tarkov?',                  DATEADD(MINUTE, -110, SYSUTCDATETIME())),
        (@c2, @demo,   N'Kraken_Demo, I am online now.',                            DATEADD(MINUTE, -100, SYSUTCDATETIME())),
        (@c3, NULL,    CONCAT(N'Order #', @o3, N' paid: 1 × Steam Wallet card 1000 RUB for 1,090.00 RUB. The money is held by Kraken Shop until the buyer confirms delivery.'), DATEADD(DAY, -3, SYSUTCDATETIME())),
        (@c3, @kraken, N'The code does not work, it says already used.',            DATEADD(HOUR, 4, DATEADD(DAY, -3, SYSUTCDATETIME()))),
        (@c3, NULL,    N'Support was called to this chat.',                         DATEADD(HOUR, 5, DATEADD(DAY, -3, SYSUTCDATETIME()))),
        (@c3, NULL,    CONCAT(N'Order #', @o3, N' refunded. The money was returned to the buyer.'), DATEADD(DAY, -2, SYSUTCDATETIME())),
        (@c4, @demo,   N'Hi! Is the legendary Gauss gun still available?',          DATEADD(MINUTE, -30, SYSUTCDATETIME())),
        (@c4, @kraken, N'Yes, 3 left. I can deliver in 10 minutes after payment.', DATEADD(MINUTE, -25, SYSUTCDATETIME()));

    INSERT INTO dbo.News (AuthorId, Title, Body, PublishedAt) VALUES
        (@team, N'Kraken Shop is open!',
                N'Buy and sell in-game items, currency and accounts for 16 games. Every deal goes through escrow: the money is held by Kraken Shop until you confirm that you received the item.',
                DATEADD(DAY, -30, SYSUTCDATETIME())),
        (@team, N'Gauss guns in Stalzone are on sale',
                N'Three sellers now offer Gauss guns of every rarity. Check the Stalzone page and compare prices.',
                DATEADD(DAY, -3, SYSUTCDATETIME())),
        (@team, N'New sections: Gift Cards and Special apps',
                N'Gift cards for Steam, PlayStation, Xbox and App Store, plus Discord Nitro, Spotify and Telegram Premium subscriptions are now available in the Services menu.',
                DATEADD(HOUR, -20, SYSUTCDATETIME()));
END
GO
