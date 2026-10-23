/*
  03_procedures.sql
  Хранимые процедуры для чатов и операций с деньгами. Каждая процедура с деньгами
  выполняется в одной транзакции: либо всё (списание, сделка, запись в кошельке), либо ничего.

  Коды ошибок (THROW) — сервер переводит их в ответы API:
    50001 лот недоступен          50005 сделка не найдена / нет доступа
    50002 нельзя купить свой лот  50006 сделка уже закрыта
    50003 нет нужного количества  50007 неверная сумма пополнения
    50004 недостаточно средств
*/
USE KrakenShop;
GO

-- Нужны для вычисляемого столбца Orders.TotalPrice (в SSMS включены по умолчанию, в sqlcmd — нет)
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- Чат по лоту: найти или создать (кнопка «TO CHAT») ---------- */
CREATE OR ALTER PROCEDURE dbo.usp_GetOrCreateConversation
    @ListingId INT,
    @BuyerId   INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;

    DECLARE @SellerId INT = (SELECT SellerId FROM dbo.Listings WHERE ListingId = @ListingId);
    IF @SellerId IS NULL
        THROW 50001, N'Offer not found', 1;
    IF @SellerId = @BuyerId
        THROW 50002, N'You cannot chat with yourself about your own offer', 1;

    DECLARE @ConversationId INT = (
        SELECT ConversationId FROM dbo.Conversations WITH (UPDLOCK, HOLDLOCK)
        WHERE ListingId = @ListingId AND BuyerId = @BuyerId);

    IF @ConversationId IS NULL
    BEGIN
        INSERT INTO dbo.Conversations (ListingId, BuyerId, SellerId) VALUES (@ListingId, @BuyerId, @SellerId);
        SET @ConversationId = SCOPE_IDENTITY();
    END

    COMMIT;
    SELECT @ConversationId AS ConversationId;
END
GO

/* ---------- Покупка лота: деньги покупателя замораживаются ---------- */
CREATE OR ALTER PROCEDURE dbo.usp_CreateOrder
    @BuyerId   INT,
    @ListingId INT,
    @Quantity  INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;   -- любая ошибка = откат всей транзакции

    BEGIN TRAN;

    DECLARE @SellerId INT, @Price DECIMAL(12,2), @Available INT, @Status VARCHAR(10), @Title NVARCHAR(120);

    -- UPDLOCK + HOLDLOCK: два покупателя не смогут одновременно купить последнюю штуку
    SELECT @SellerId = SellerId, @Price = Price, @Available = Quantity, @Status = Status, @Title = Title
    FROM dbo.Listings WITH (UPDLOCK, HOLDLOCK)
    WHERE ListingId = @ListingId;

    IF @SellerId IS NULL OR @Status <> 'active'
        THROW 50001, N'This offer is not available', 1;
    IF @SellerId = @BuyerId
        THROW 50002, N'You cannot buy your own offer', 1;
    IF @Quantity < 1 OR @Quantity > @Available
        THROW 50003, N'The seller does not have that many', 1;

    DECLARE @Total DECIMAL(12,2) = @Price * @Quantity;

    UPDATE dbo.Users
    SET Balance = Balance - @Total, UpdatedAt = SYSUTCDATETIME()
    WHERE UserId = @BuyerId AND Balance >= @Total;

    IF @@ROWCOUNT = 0
        THROW 50004, N'Not enough money on your balance', 1;

    UPDATE dbo.Listings
    SET Quantity  = Quantity - @Quantity,
        Status    = CASE WHEN Quantity - @Quantity = 0 THEN 'sold' ELSE Status END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE ListingId = @ListingId;

    -- чат покупателя с продавцом по этому лоту (создаётся при первой покупке)
    DECLARE @ConversationId INT = (
        SELECT ConversationId FROM dbo.Conversations WITH (UPDLOCK, HOLDLOCK)
        WHERE ListingId = @ListingId AND BuyerId = @BuyerId);
    IF @ConversationId IS NULL
    BEGIN
        INSERT INTO dbo.Conversations (ListingId, BuyerId, SellerId) VALUES (@ListingId, @BuyerId, @SellerId);
        SET @ConversationId = SCOPE_IDENTITY();
    END

    INSERT INTO dbo.Orders (ListingId, ConversationId, BuyerId, SellerId, Quantity, UnitPrice)
    VALUES (@ListingId, @ConversationId, @BuyerId, @SellerId, @Quantity, @Price);

    DECLARE @OrderId INT = SCOPE_IDENTITY();

    INSERT INTO dbo.Transactions (UserId, OrderId, Amount, Type, BalanceAfter)
    SELECT @BuyerId, @OrderId, -@Total, 'purchase', Balance FROM dbo.Users WHERE UserId = @BuyerId;

    INSERT INTO dbo.Messages (ConversationId, SenderId, Text)
    VALUES (@ConversationId, NULL,
            CONCAT(N'Order #', @OrderId, N' paid: ', @Quantity, N' × ', @Title, N' for ', FORMAT(@Total, 'N2'),
                   N' RUB. The money is held by Kraken Shop until the buyer confirms delivery.'));
    UPDATE dbo.Conversations SET LastMessageAt = SYSUTCDATETIME() WHERE ConversationId = @ConversationId;

    COMMIT;

    SELECT @OrderId AS OrderId, @ConversationId AS ConversationId;
END
GO

/* ---------- Покупатель подтверждает получение: деньги уходят продавцу ---------- */
CREATE OR ALTER PROCEDURE dbo.usp_CompleteOrder
    @OrderId INT,
    @BuyerId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;

    DECLARE @SellerId INT, @Total DECIMAL(12,2), @Status VARCHAR(10), @ConversationId INT;

    SELECT @SellerId = SellerId, @Total = TotalPrice, @Status = Status, @ConversationId = ConversationId
    FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
    WHERE OrderId = @OrderId AND BuyerId = @BuyerId;

    IF @SellerId IS NULL
        THROW 50005, N'Order not found', 1;
    IF @Status NOT IN ('paid', 'disputed')
        THROW 50006, N'This order is already closed', 1;

    UPDATE dbo.Orders SET Status = 'completed', ClosedAt = SYSUTCDATETIME() WHERE OrderId = @OrderId;

    UPDATE dbo.Users SET Balance = Balance + @Total, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @SellerId;

    INSERT INTO dbo.Transactions (UserId, OrderId, Amount, Type, BalanceAfter)
    SELECT @SellerId, @OrderId, @Total, 'sale', Balance FROM dbo.Users WHERE UserId = @SellerId;

    INSERT INTO dbo.Messages (ConversationId, SenderId, Text)
    VALUES (@ConversationId, NULL, CONCAT(N'Order #', @OrderId, N' completed. The money was sent to the seller.'));
    UPDATE dbo.Conversations SET LastMessageAt = SYSUTCDATETIME() WHERE ConversationId = @ConversationId;

    COMMIT;
END
GO

/* ---------- Продавец возвращает деньги: товар возвращается в лот ---------- */
CREATE OR ALTER PROCEDURE dbo.usp_RefundOrder
    @OrderId  INT,
    @SellerId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;

    DECLARE @BuyerId INT, @ListingId INT, @Quantity INT, @Total DECIMAL(12,2), @Status VARCHAR(10), @ConversationId INT;

    SELECT @BuyerId = BuyerId, @ListingId = ListingId, @Quantity = Quantity, @Total = TotalPrice,
           @Status = Status, @ConversationId = ConversationId
    FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
    WHERE OrderId = @OrderId AND SellerId = @SellerId;

    IF @BuyerId IS NULL
        THROW 50005, N'Order not found', 1;
    IF @Status NOT IN ('paid', 'disputed')
        THROW 50006, N'This order is already closed', 1;

    UPDATE dbo.Orders SET Status = 'refunded', ClosedAt = SYSUTCDATETIME() WHERE OrderId = @OrderId;

    UPDATE dbo.Users SET Balance = Balance + @Total, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @BuyerId;

    INSERT INTO dbo.Transactions (UserId, OrderId, Amount, Type, BalanceAfter)
    SELECT @BuyerId, @OrderId, @Total, 'refund', Balance FROM dbo.Users WHERE UserId = @BuyerId;

    -- вернуть товар в продажу (если продавец не снял лот)
    UPDATE dbo.Listings
    SET Quantity  = Quantity + @Quantity,
        Status    = CASE WHEN Status = 'sold' THEN 'active' ELSE Status END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE ListingId = @ListingId;

    INSERT INTO dbo.Messages (ConversationId, SenderId, Text)
    VALUES (@ConversationId, NULL, CONCAT(N'Order #', @OrderId, N' refunded. The money was returned to the buyer.'));
    UPDATE dbo.Conversations SET LastMessageAt = SYSUTCDATETIME() WHERE ConversationId = @ConversationId;

    COMMIT;
END
GO

/* ---------- Пополнение баланса (учебное: без настоящей платёжной системы) ---------- */
CREATE OR ALTER PROCEDURE dbo.usp_Deposit
    @UserId INT,
    @Amount DECIMAL(12,2)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Amount <= 0 OR @Amount > 100000
        THROW 50007, N'Top-up amount must be from 1 to 100 000 RUB', 1;

    BEGIN TRAN;

    UPDATE dbo.Users SET Balance = Balance + @Amount, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @UserId;

    INSERT INTO dbo.Transactions (UserId, Amount, Type, BalanceAfter)
    SELECT @UserId, @Amount, 'deposit', Balance FROM dbo.Users WHERE UserId = @UserId;

    COMMIT;

    SELECT Balance FROM dbo.Users WHERE UserId = @UserId;
END
GO
