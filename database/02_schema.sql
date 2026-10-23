/*
  02_schema.sql
  Таблицы, связи (FOREIGN KEY), ограничения, индексы и представление базы KrakenShop.

  Сущности:
    Users         — пользователи (покупатели и продавцы), баланс кошелька
    Sessions      — сессии входа                                (Users 1 : N)
    Games         — игры (CS2, Dota 2, Genshin Impact, ...)
    Categories    — разделы игры: предметы, валюта, аккаунты, услуги (Games 1 : N)
    Listings      — лоты (объявления) продавцов                 (Users 1 : N, Categories 1 : N)
    Orders        — сделки: покупатель купил лот               (Listings 1 : N, Users 1 : N дважды)
    Transactions  — движение денег по кошельку                 (Users 1 : N, Orders 1 : N)
    Reviews       — отзыв покупателя о сделке                   (Orders 1 : 0..1)
    Messages      — чат внутри сделки                           (Orders 1 : N)

  Каскадное удаление стоит только там, где оно безопасно (Sessions, Categories):
  SQL Server запрещает несколько каскадных путей к одной таблице, а сделки и деньги
  удалять вместе с пользователем нельзя.
*/
USE KrakenShop;
GO

/* ---------- Users ---------- */
IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
        Username      NVARCHAR(32)      NOT NULL,
        Email         NVARCHAR(255)     NOT NULL,
        PasswordHash  NVARCHAR(255)     NOT NULL,
        AvatarDataUrl NVARCHAR(MAX)     NULL,
        Balance       DECIMAL(12,2)     NOT NULL CONSTRAINT DF_Users_Balance DEFAULT 0,
        CreatedAt     DATETIME2(0)      NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2(0)      NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT SYSUTCDATETIME(),
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

/* ---------- Games ---------- */
IF OBJECT_ID(N'dbo.Games', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Games (
        GameId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Games PRIMARY KEY,
        Name        NVARCHAR(100)     NOT NULL,
        Slug        VARCHAR(50)       NOT NULL,   -- часть адреса: /games/cs2
        Description NVARCHAR(500)     NULL,
        SortOrder   INT               NOT NULL CONSTRAINT DF_Games_SortOrder DEFAULT 0,
        CONSTRAINT UQ_Games_Name UNIQUE (Name),
        CONSTRAINT UQ_Games_Slug UNIQUE (Slug),
        CONSTRAINT CK_Games_Slug CHECK (Slug NOT LIKE '%[^a-z0-9-]%')
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
        Kind       VARCHAR(10)       NOT NULL,
        CONSTRAINT UQ_Categories_Game_Slug UNIQUE (GameId, Slug),
        CONSTRAINT FK_Categories_Games FOREIGN KEY (GameId) REFERENCES dbo.Games (GameId) ON DELETE CASCADE,
        CONSTRAINT CK_Categories_Kind CHECK (Kind IN ('item', 'currency', 'account', 'service'))
    );
END
GO

/* ---------- Listings (лоты) ---------- */
IF OBJECT_ID(N'dbo.Listings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Listings (
        ListingId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Listings PRIMARY KEY,
        SellerId    INT               NOT NULL,
        CategoryId  INT               NOT NULL,
        Title       NVARCHAR(120)     NOT NULL,
        Description NVARCHAR(2000)    NULL,
        Price       DECIMAL(12,2)     NOT NULL,   -- цена за 1 штуку, ₽
        Quantity    INT               NOT NULL,   -- сколько штук осталось
        Status      VARCHAR(10)       NOT NULL CONSTRAINT DF_Listings_Status DEFAULT 'active',
        CreatedAt   DATETIME2(0)      NOT NULL CONSTRAINT DF_Listings_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2(0)      NOT NULL CONSTRAINT DF_Listings_UpdatedAt DEFAULT SYSUTCDATETIME(),
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

/* ---------- Orders (сделки) ---------- */
IF OBJECT_ID(N'dbo.Orders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Orders (
        OrderId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
        ListingId  INT               NOT NULL,
        BuyerId    INT               NOT NULL,
        SellerId   INT               NOT NULL,
        Quantity   INT               NOT NULL,
        UnitPrice  DECIMAL(12,2)     NOT NULL,   -- цена на момент покупки (лот потом могут изменить)
        TotalPrice AS (CONVERT(DECIMAL(12,2), Quantity * UnitPrice)) PERSISTED,
        -- paid      — деньги покупателя заморожены, продавец должен передать товар
        -- completed — покупатель подтвердил получение, деньги ушли продавцу
        -- disputed  — покупатель открыл спор
        -- refunded  — продавец вернул деньги
        Status     VARCHAR(10)       NOT NULL CONSTRAINT DF_Orders_Status DEFAULT 'paid',
        CreatedAt  DATETIME2(0)      NOT NULL CONSTRAINT DF_Orders_CreatedAt DEFAULT SYSUTCDATETIME(),
        ClosedAt   DATETIME2(0)      NULL,
        CONSTRAINT FK_Orders_Listings FOREIGN KEY (ListingId) REFERENCES dbo.Listings (ListingId),
        CONSTRAINT FK_Orders_Buyer    FOREIGN KEY (BuyerId)   REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_Orders_Seller   FOREIGN KEY (SellerId)  REFERENCES dbo.Users (UserId),
        CONSTRAINT CK_Orders_Quantity CHECK (Quantity > 0),
        CONSTRAINT CK_Orders_NotSelf  CHECK (BuyerId <> SellerId),
        CONSTRAINT CK_Orders_Status   CHECK (Status IN ('paid', 'completed', 'disputed', 'refunded'))
    );
    CREATE INDEX IX_Orders_Buyer  ON dbo.Orders (BuyerId, CreatedAt DESC);
    CREATE INDEX IX_Orders_Seller ON dbo.Orders (SellerId, CreatedAt DESC);
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
        CONSTRAINT UQ_Reviews_Order    UNIQUE (OrderId),   -- один отзыв на сделку
        CONSTRAINT FK_Reviews_Orders   FOREIGN KEY (OrderId)  REFERENCES dbo.Orders (OrderId),
        CONSTRAINT FK_Reviews_Author   FOREIGN KEY (AuthorId) REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_Reviews_Seller   FOREIGN KEY (SellerId) REFERENCES dbo.Users (UserId),
        CONSTRAINT CK_Reviews_Rating   CHECK (Rating BETWEEN 1 AND 5)
    );
    CREATE INDEX IX_Reviews_Seller ON dbo.Reviews (SellerId, CreatedAt DESC);
END
GO

/* ---------- Messages (чат сделки) ---------- */
IF OBJECT_ID(N'dbo.Messages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Messages (
        MessageId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Messages PRIMARY KEY,
        OrderId   INT                  NOT NULL,
        SenderId  INT                  NOT NULL,
        Text      NVARCHAR(1000)       NOT NULL,
        CreatedAt DATETIME2(0)         NOT NULL CONSTRAINT DF_Messages_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Messages_Orders FOREIGN KEY (OrderId)  REFERENCES dbo.Orders (OrderId),
        CONSTRAINT FK_Messages_Users  FOREIGN KEY (SenderId) REFERENCES dbo.Users (UserId),
        CONSTRAINT CK_Messages_Text   CHECK (LEN(Text) >= 1)
    );
    CREATE INDEX IX_Messages_Order ON dbo.Messages (OrderId, MessageId);
END
GO

/* ---------- Представление: статистика продавца ---------- */
CREATE OR ALTER VIEW dbo.vw_SellerStats
AS
SELECT u.UserId,
       u.Username,
       u.CreatedAt,
       (SELECT COUNT(*) FROM dbo.Orders o WHERE o.SellerId = u.UserId AND o.Status = 'completed') AS SalesCount,
       (SELECT COUNT(*) FROM dbo.Reviews r WHERE r.SellerId = u.UserId)                          AS ReviewsCount,
       (SELECT CAST(AVG(CAST(r.Rating AS DECIMAL(3,2))) AS DECIMAL(3,2))
          FROM dbo.Reviews r WHERE r.SellerId = u.UserId)                                       AS AvgRating,
       (SELECT COUNT(*) FROM dbo.Listings l WHERE l.SellerId = u.UserId AND l.Status = 'active') AS ActiveListings
FROM dbo.Users AS u;
GO
