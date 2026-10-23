/*
  02_schema.sql
  Таблицы, связи (FOREIGN KEY), ограничения, индексы и представление базы KrakenShop.

  Сущности (12 таблиц):
    Users          — пользователи (покупатели и продавцы), баланс кошелька
    Sessions       — сессии входа                                    (Users 1 : N)
    Games          — игры и сервисы (CS 2, Dota 2, ..., Gift Cards)
    Categories     — разделы: предметы, валюта, аккаунты, услуги      (Games 1 : N)
    Listings       — лоты (предложения) продавцов                    (Users 1 : N, Categories 1 : N)
    Conversations  — чат покупателя с продавцом по лоту              (Listings 1 : N, Users 1 : N дважды)
    Messages       — сообщения чата                                  (Conversations 1 : N)
    Orders         — сделки                                          (Listings 1 : N, Conversations 1 : N, Users 1 : N дважды)
    Transactions   — движение денег по кошельку                      (Users 1 : N, Orders 1 : N)
    Reviews        — отзыв покупателя о сделке                       (Orders 1 : 0..1)
    News           — новости сайта                                   (Users 1 : N, автор)
    ExchangeRates  — курсы валют для полосы «Exchange rate»

  Каскадное удаление стоит только там, где оно безопасно (Sessions, Categories):
  SQL Server запрещает несколько каскадных путей к одной таблице, а сделки и деньги
  удалять вместе с пользователем нельзя.
*/
USE KrakenShop;
GO

-- Нужны для вычисляемого столбца Orders.TotalPrice (в SSMS включены по умолчанию, в sqlcmd — нет)
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- Users ---------- */
IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
        Username        NVARCHAR(32)      NOT NULL,   -- Nickname
        Email           NVARCHAR(255)     NOT NULL,
        PasswordHash    NVARCHAR(255)     NOT NULL,
        SpecialCodeHash NVARCHAR(255)     NULL,       -- «Special code»: второй секрет при входе, если задан
        RealName        NVARCHAR(100)     NULL,
        AvatarDataUrl   NVARCHAR(MAX)     NULL,
        Balance         DECIMAL(12,2)     NOT NULL CONSTRAINT DF_Users_Balance DEFAULT 0,
        CreatedAt       DATETIME2(0)      NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2(0)      NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_Users_Username UNIQUE (Username),
        CONSTRAINT UQ_Users_Email    UNIQUE (Email),
        CONSTRAINT CK_Users_Username CHECK (LEN(Username) >= 3 AND Username NOT LIKE N'%[^A-Za-z0-9_]%'),
        CONSTRAINT CK_Users_Email    CHECK (Email LIKE N'%_@_%._%'),
        CONSTRAINT CK_Users_Balance  CHECK (Balance >= 0)   -- баланс не может уйти в минус
    );
END
GO

/* ---------- Sessions ---------- */
IF OBJECT_ID(N'dbo.Sessions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Sessions (
        SessionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sessions PRIMARY KEY,
        UserId    INT               NOT NULL,
        TokenHash CHAR(64)          NOT NULL,  -- SHA-256 от токена из cookie; сам токен в БД не хранится
        CreatedAt DATETIME2(0)      NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT SYSUTCDATETIME(),
        ExpiresAt DATETIME2(0)      NOT NULL,
        CONSTRAINT UQ_Sessions_TokenHash UNIQUE (TokenHash),
        CONSTRAINT FK_Sessions_Users FOREIGN KEY (UserId) REFERENCES dbo.Users (UserId) ON DELETE CASCADE
    );
    CREATE INDEX IX_Sessions_UserId ON dbo.Sessions (UserId);
END
GO

/* ---------- Games (игры и сервисы) ---------- */
IF OBJECT_ID(N'dbo.Games', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Games (
        GameId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Games PRIMARY KEY,
        Name        NVARCHAR(100)     NOT NULL,
        Slug        VARCHAR(50)       NOT NULL,   -- часть адреса: /games/cs2, /services/gift-cards
        Section     VARCHAR(10)       NOT NULL CONSTRAINT DF_Games_Section DEFAULT 'game',
        Description NVARCHAR(500)     NULL,
        SortOrder   INT               NOT NULL CONSTRAINT DF_Games_SortOrder DEFAULT 0,
        CONSTRAINT UQ_Games_Name    UNIQUE (Name),
        CONSTRAINT UQ_Games_Slug    UNIQUE (Slug),
        CONSTRAINT CK_Games_Slug    CHECK (Slug NOT LIKE '%[^a-z0-9-]%'),
        CONSTRAINT CK_Games_Section CHECK (Section IN ('game', 'service'))
    );
END
GO

/* ---------- Categories ---------- */
IF OBJECT_ID(N'dbo.Categories', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Categories (
        CategoryId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Categories PRIMARY KEY,
        GameId     INT               NOT NULL,
        Name       NVARCHAR(100)     NOT NULL,
        Slug       VARCHAR(50)       NOT NULL,
        Kind       VARCHAR(10)       NOT NULL,   -- от вида зависит иконка лота без картинки
        CONSTRAINT UQ_Categories_Game_Slug UNIQUE (GameId, Slug),
        CONSTRAINT FK_Categories_Games FOREIGN KEY (GameId) REFERENCES dbo.Games (GameId) ON DELETE CASCADE,
        CONSTRAINT CK_Categories_Kind CHECK (Kind IN ('item', 'currency', 'account', 'service', 'giftcard', 'app'))
    );
END
GO

/* ---------- Listings (лоты / offers) ---------- */
IF OBJECT_ID(N'dbo.Listings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Listings (
        ListingId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Listings PRIMARY KEY,
        SellerId     INT               NOT NULL,
        CategoryId   INT               NOT NULL,
        Title        NVARCHAR(120)     NOT NULL,
        Description  NVARCHAR(2000)    NULL,
        Price        DECIMAL(12,2)     NOT NULL,   -- цена за 1 штуку, ₽
        Quantity     INT               NOT NULL,   -- сколько штук осталось
        ImageDataUrl NVARCHAR(MAX)     NULL,       -- картинка лота (data:image/...), NULL — иконка раздела
        Status       VARCHAR(10)       NOT NULL CONSTRAINT DF_Listings_Status DEFAULT 'active',
        CreatedAt    DATETIME2(0)      NOT NULL CONSTRAINT DF_Listings_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2(0)      NOT NULL CONSTRAINT DF_Listings_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Listings_Users      FOREIGN KEY (SellerId)   REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_Listings_Categories FOREIGN KEY (CategoryId) REFERENCES dbo.Categories (CategoryId),
        CONSTRAINT CK_Listings_Title    CHECK (LEN(Title) >= 3),
        CONSTRAINT CK_Listings_Price    CHECK (Price > 0),
        CONSTRAINT CK_Listings_Quantity CHECK (Quantity >= 0),
        CONSTRAINT CK_Listings_Status   CHECK (Status IN ('active', 'sold', 'closed'))
    );
    CREATE INDEX IX_Listings_Category_Status_Price ON dbo.Listings (CategoryId, Status, Price);
    CREATE INDEX IX_Listings_Seller ON dbo.Listings (SellerId, Status);
END
GO

/* ---------- Conversations (чат по лоту: «TO CHAT») ---------- */
IF OBJECT_ID(N'dbo.Conversations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Conversations (
        ConversationId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Conversations PRIMARY KEY,
        ListingId          INT               NOT NULL,
        BuyerId            INT               NOT NULL,
        SellerId           INT               NOT NULL,
        SupportRequestedAt DATETIME2(0)      NULL,      -- нажата кнопка «CALL SUPPORT»
        CreatedAt          DATETIME2(0)      NOT NULL CONSTRAINT DF_Conversations_CreatedAt DEFAULT SYSUTCDATETIME(),
        LastMessageAt      DATETIME2(0)      NOT NULL CONSTRAINT DF_Conversations_LastMessageAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_Conversations_Listing_Buyer UNIQUE (ListingId, BuyerId),   -- один чат на лот и покупателя
        CONSTRAINT FK_Conversations_Listings FOREIGN KEY (ListingId) REFERENCES dbo.Listings (ListingId),
        CONSTRAINT FK_Conversations_Buyer    FOREIGN KEY (BuyerId)   REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_Conversations_Seller   FOREIGN KEY (SellerId)  REFERENCES dbo.Users (UserId),
        CONSTRAINT CK_Conversations_NotSelf  CHECK (BuyerId <> SellerId)
    );
    CREATE INDEX IX_Conversations_Buyer  ON dbo.Conversations (BuyerId, LastMessageAt DESC);
    CREATE INDEX IX_Conversations_Seller ON dbo.Conversations (SellerId, LastMessageAt DESC);
END
GO

/* ---------- Messages ---------- */
IF OBJECT_ID(N'dbo.Messages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Messages (
        MessageId         BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Messages PRIMARY KEY,
        ConversationId    INT                  NOT NULL,
        SenderId          INT                  NULL,       -- NULL = системное сообщение (оплата, возврат, ...)
        Text              NVARCHAR(1000)       NULL,
        AttachmentDataUrl NVARCHAR(MAX)        NULL,       -- картинка (скрепка в чате)
        CreatedAt         DATETIME2(0)         NOT NULL CONSTRAINT DF_Messages_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Messages_Conversations FOREIGN KEY (ConversationId) REFERENCES dbo.Conversations (ConversationId),
        CONSTRAINT FK_Messages_Users         FOREIGN KEY (SenderId)       REFERENCES dbo.Users (UserId),
        CONSTRAINT CK_Messages_NotEmpty      CHECK (Text IS NOT NULL OR AttachmentDataUrl IS NOT NULL)
    );
    CREATE INDEX IX_Messages_Conversation ON dbo.Messages (ConversationId, MessageId);
END
GO

/* ---------- Orders (сделки) ---------- */
IF OBJECT_ID(N'dbo.Orders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Orders (
        OrderId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
        ListingId      INT               NOT NULL,
        ConversationId INT               NOT NULL,
        BuyerId        INT               NOT NULL,
        SellerId       INT               NOT NULL,
        Quantity       INT               NOT NULL,
        UnitPrice      DECIMAL(12,2)     NOT NULL,   -- цена на момент покупки (лот потом могут изменить)
        TotalPrice     AS (CONVERT(DECIMAL(12,2), Quantity * UnitPrice)) PERSISTED,
        -- paid      — деньги покупателя заморожены, продавец должен передать товар
        -- completed — покупатель подтвердил получение, деньги ушли продавцу
        -- disputed  — покупатель открыл спор
        -- refunded  — продавец вернул деньги
        Status         VARCHAR(10)       NOT NULL CONSTRAINT DF_Orders_Status DEFAULT 'paid',
        CreatedAt      DATETIME2(0)      NOT NULL CONSTRAINT DF_Orders_CreatedAt DEFAULT SYSUTCDATETIME(),
        ClosedAt       DATETIME2(0)      NULL,
        CONSTRAINT FK_Orders_Listings      FOREIGN KEY (ListingId)      REFERENCES dbo.Listings (ListingId),
        CONSTRAINT FK_Orders_Conversations FOREIGN KEY (ConversationId) REFERENCES dbo.Conversations (ConversationId),
        CONSTRAINT FK_Orders_Buyer         FOREIGN KEY (BuyerId)        REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_Orders_Seller        FOREIGN KEY (SellerId)       REFERENCES dbo.Users (UserId),
        CONSTRAINT CK_Orders_Quantity CHECK (Quantity > 0),
        CONSTRAINT CK_Orders_NotSelf  CHECK (BuyerId <> SellerId),
        CONSTRAINT CK_Orders_Status   CHECK (Status IN ('paid', 'completed', 'disputed', 'refunded'))
    );
    CREATE INDEX IX_Orders_Buyer        ON dbo.Orders (BuyerId, CreatedAt DESC);
    CREATE INDEX IX_Orders_Seller       ON dbo.Orders (SellerId, CreatedAt DESC);
    CREATE INDEX IX_Orders_Conversation ON dbo.Orders (ConversationId);
END
GO

/* ---------- Transactions (кошелёк) ---------- */
IF OBJECT_ID(N'dbo.Transactions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Transactions (
        TransactionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Transactions PRIMARY KEY,
        UserId        INT                  NOT NULL,
        OrderId       INT                  NULL,      -- NULL для пополнения
        Amount        DECIMAL(12,2)        NOT NULL,  -- + поступление, − списание
        Type          VARCHAR(10)          NOT NULL,
        BalanceAfter  DECIMAL(12,2)        NOT NULL,
        CreatedAt     DATETIME2(0)         NOT NULL CONSTRAINT DF_Transactions_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Transactions_Users  FOREIGN KEY (UserId)  REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_Transactions_Orders FOREIGN KEY (OrderId) REFERENCES dbo.Orders (OrderId),
        CONSTRAINT CK_Transactions_Type   CHECK (Type IN ('deposit', 'purchase', 'sale', 'refund')),
        CONSTRAINT CK_Transactions_Amount CHECK (Amount <> 0)
    );
    CREATE INDEX IX_Transactions_User ON dbo.Transactions (UserId, CreatedAt DESC);
END
GO

/* ---------- Reviews ---------- */
IF OBJECT_ID(N'dbo.Reviews', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Reviews (
        ReviewId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Reviews PRIMARY KEY,
        OrderId   INT               NOT NULL,
        AuthorId  INT               NOT NULL,
        SellerId  INT               NOT NULL,
        Rating    TINYINT           NOT NULL,
        Text      NVARCHAR(1000)    NULL,
        CreatedAt DATETIME2(0)      NOT NULL CONSTRAINT DF_Reviews_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_Reviews_Order  UNIQUE (OrderId),   -- один отзыв на сделку
        CONSTRAINT FK_Reviews_Orders FOREIGN KEY (OrderId)  REFERENCES dbo.Orders (OrderId),
        CONSTRAINT FK_Reviews_Author FOREIGN KEY (AuthorId) REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_Reviews_Seller FOREIGN KEY (SellerId) REFERENCES dbo.Users (UserId),
        CONSTRAINT CK_Reviews_Rating CHECK (Rating BETWEEN 1 AND 5)
    );
    CREATE INDEX IX_Reviews_Seller ON dbo.Reviews (SellerId, CreatedAt DESC);
END
GO

/* ---------- News ---------- */
IF OBJECT_ID(N'dbo.News', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.News (
        NewsId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_News PRIMARY KEY,
        AuthorId    INT               NULL,
        Title       NVARCHAR(200)     NOT NULL,
        Body        NVARCHAR(4000)    NOT NULL,
        PublishedAt DATETIME2(0)      NOT NULL CONSTRAINT DF_News_PublishedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_News_Users FOREIGN KEY (AuthorId) REFERENCES dbo.Users (UserId)
    );
    CREATE INDEX IX_News_PublishedAt ON dbo.News (PublishedAt DESC);
END
GO

/* ---------- ExchangeRates ---------- */
IF OBJECT_ID(N'dbo.ExchangeRates', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ExchangeRates (
        CurrencyCode CHAR(3)       NOT NULL CONSTRAINT PK_ExchangeRates PRIMARY KEY,   -- USD, EUR
        RateRub      DECIMAL(12,4) NOT NULL,
        UpdatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_ExchangeRates_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_ExchangeRates_Rate CHECK (RateRub > 0)
    );
END
GO

/* ---------- Представление: статистика пользователя (страница Account information) ---------- */
-- SocialCredit: +10 за каждую завершённую сделку, +20 за каждую звезду отзыва выше 3 (−20 ниже 3),
--               −100 за каждую сделку продавца, закончившуюся спором или возвратом.
CREATE OR ALTER VIEW dbo.vw_SellerStats
AS
SELECT u.UserId,
       u.Username,
       u.RealName,
       u.CreatedAt,
       d.SalesCount,
       d.DealsCount,
       r.ReviewsCount,
       r.AvgRating,
       (SELECT COUNT(*) FROM dbo.Listings l WHERE l.SellerId = u.UserId AND l.Status = 'active') AS ActiveListings,
       10 * d.DealsCount + 20 * r.RatingBalance - 100 * d.BadSales AS SocialCredit
FROM dbo.Users AS u
CROSS APPLY (
    SELECT (SELECT COUNT(*) FROM dbo.Orders o WHERE o.SellerId = u.UserId AND o.Status = 'completed') AS SalesCount,
           (SELECT COUNT(*) FROM dbo.Orders o WHERE (o.SellerId = u.UserId OR o.BuyerId = u.UserId)
                                                AND o.Status = 'completed')                       AS DealsCount,
           (SELECT COUNT(*) FROM dbo.Orders o WHERE o.SellerId = u.UserId
                                                AND o.Status IN ('disputed', 'refunded'))         AS BadSales
) AS d
CROSS APPLY (
    SELECT COUNT(*) AS ReviewsCount,
           CAST(AVG(CAST(rv.Rating AS DECIMAL(3,2))) AS DECIMAL(3,2)) AS AvgRating,
           ISNULL(SUM(CAST(rv.Rating AS INT) - 3), 0) AS RatingBalance
    FROM dbo.Reviews AS rv WHERE rv.SellerId = u.UserId
) AS r;
GO
