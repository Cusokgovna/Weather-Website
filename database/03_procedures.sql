/*
  03_procedures.sql
  Хранимые процедуры для операций с деньгами. Каждая выполняется в одной транзакции:
  либо всё (списание, сделка, запись в кошельке), либо ничего.

  Коды ошибок (THROW) — сервер переводит их в понятные ответы API:
    50001 лот недоступен          50005 сделка не найдена / нет доступа
    50002 нельзя купить свой лот  50006 неверный статус сделки
    50003 нет нужного количества  50007 неверная сумма
    50004 недостаточно средств
*/
USE KrakenShop;
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

    DECLARE @SellerId INT, @Price DECIMAL(12,2), @Available INT, @Status VARCHAR(10);

    -- UPDLOCK + HOLDLOCK: два покупателя не смогут одновременно купить последнюю штуку
    SELECT @SellerId = SellerId, @Price = Price, @Available = Quantity, @Status = Status
    FROM dbo.Listings WITH (UPDLOCK, HOLDLOCK)
    WHERE ListingId = @ListingId;

    IF @SellerId IS NULL OR @Status <> 'active'
        THROW 50001, N'Лот недоступен', 1;
    IF @SellerId = @BuyerId
        THROW 50002, N'Нельзя купить свой собственный лот', 1;
    IF @Quantity < 1 OR @Quantity > @Available
        THROW 50003, N'У продавца нет такого количества', 1;

    DECLARE @Total DECIMAL(12,2) = @Price * @Quantity;

    UPDATE dbo.Users
    SET Balance = Balance - @Total, UpdatedAt = SYSUTCDATETIME()
    WHERE UserId = @BuyerId AND Balance >= @Total;

    IF @@ROWCOUNT = 0
        THROW 50004, N'Недостаточно средств на балансе', 1;

    UPDATE dbo.Listings
    SET Quantity  = Quantity - @Quantity,
        Status    = CASE WHEN Quantity - @Quantity = 0 THEN 'sold' ELSE Status END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE ListingId = @ListingId;

    INSERT INTO dbo.Orders (ListingId, BuyerId, SellerId, Quantity, UnitPrice)
    VALUES (@ListingId, @BuyerId, @SellerId, @Quantity, @Price);

    DECLARE @OrderId INT = SCOPE_IDENTITY();

    INSERT INTO dbo.Transactions (UserId, OrderId, Amount, Type, BalanceAfter)
    SELECT @BuyerId, @OrderId, -@Total, 'purchase', Balance FROM dbo.Users WHERE UserId = @BuyerId;

    COMMIT;

    SELECT @OrderId AS OrderId;
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

    DECLARE @SellerId INT, @Total DECIMAL(12,2), @Status VARCHAR(10);

    SELECT @SellerId = SellerId, @Total = TotalPrice, @Status = Status
    FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
    WHERE OrderId = @OrderId AND BuyerId = @BuyerId;

    IF @SellerId IS NULL
        THROW 50005, N'Сделка не найдена', 1;
    IF @Status NOT IN ('paid', 'disputed')
        THROW 50006, N'Сделка уже закрыта', 1;

    UPDATE dbo.Orders SET Status = 'completed', ClosedAt = SYSUTCDATETIME() WHERE OrderId = @OrderId;

    UPDATE dbo.Users SET Balance = Balance + @Total, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @SellerId;

    INSERT INTO dbo.Transactions (UserId, OrderId, Amount, Type, BalanceAfter)
    SELECT @SellerId, @OrderId, @Total, 'sale', Balance FROM dbo.Users WHERE UserId = @SellerId;

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

    DECLARE @BuyerId INT, @ListingId INT, @Quantity INT, @Total DECIMAL(12,2), @Status VARCHAR(10);

    SELECT @BuyerId = BuyerId, @ListingId = ListingId, @Quantity = Quantity, @Total = TotalPrice, @Status = Status
    FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
    WHERE OrderId = @OrderId AND SellerId = @SellerId;

    IF @BuyerId IS NULL
        THROW 50005, N'Сделка не найдена', 1;
    IF @Status NOT IN ('paid', 'disputed')
        THROW 50006, N'Сделка уже закрыта', 1;

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
        THROW 50007, N'Сумма пополнения должна быть от 1 до 100 000 ₽', 1;

    BEGIN TRAN;

    UPDATE dbo.Users SET Balance = Balance + @Amount, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @UserId;

    INSERT INTO dbo.Transactions (UserId, Amount, Type, BalanceAfter)
    SELECT @UserId, @Amount, 'deposit', Balance FROM dbo.Users WHERE UserId = @UserId;

    COMMIT;

    SELECT Balance FROM dbo.Users WHERE UserId = @UserId;
END
GO
