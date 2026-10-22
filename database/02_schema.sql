/*
  02_schema.sql
  Таблицы, связи (FOREIGN KEY), ограничения и индексы базы WeatherDb.

  Сущности:
    Users            — пользователи сайта
    UserSettings     — настройки пользователя (1 : 1 с Users)
    Sessions         — сессии входа (1 : N с Users)
    Cities           — города (справочник, заполняется из OpenWeather Geocoding)
    FavoriteCities   — избранные города (N : M между Users и Cities)
    SearchHistory    — история поиска (N : 1 к Users и к Cities)
    WeatherSnapshots — сохранённые замеры погоды (N : 1 к Cities)
*/
USE WeatherDb;
GO

/* ---------- Users ---------- */
IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
        Name          NVARCHAR(100)     NOT NULL,
        Email         NVARCHAR(255)     NOT NULL,
        PasswordHash  NVARCHAR(255)     NOT NULL,
        AvatarDataUrl NVARCHAR(MAX)     NULL,
        CreatedAt     DATETIME2(0)      NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2(0)      NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_Users_Email UNIQUE (Email),
        CONSTRAINT CK_Users_Name  CHECK (LEN(Name) >= 2),
        CONSTRAINT CK_Users_Email CHECK (Email LIKE N'%_@_%._%')
    );
END
GO

/* ---------- UserSettings (1:1) ---------- */
IF OBJECT_ID(N'dbo.UserSettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserSettings (
        UserId   INT          NOT NULL CONSTRAINT PK_UserSettings PRIMARY KEY,
        Theme    NVARCHAR(10) NOT NULL CONSTRAINT DF_UserSettings_Theme DEFAULT N'dark',
        Units    NVARCHAR(10) NOT NULL CONSTRAINT DF_UserSettings_Units DEFAULT N'metric',
        Language NVARCHAR(5)  NOT NULL CONSTRAINT DF_UserSettings_Language DEFAULT N'en',
        CONSTRAINT FK_UserSettings_Users FOREIGN KEY (UserId)
            REFERENCES dbo.Users (UserId) ON DELETE CASCADE,
        CONSTRAINT CK_UserSettings_Theme CHECK (Theme IN (N'dark', N'light')),
        CONSTRAINT CK_UserSettings_Units CHECK (Units IN (N'metric', N'imperial'))
    );
END
GO

/* ---------- Sessions (1:N) ---------- */
IF OBJECT_ID(N'dbo.Sessions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Sessions (
        SessionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sessions PRIMARY KEY,
        UserId    INT               NOT NULL,
        TokenHash CHAR(64)          NOT NULL,  -- SHA-256 от токена из cookie, сам токен в БД не хранится
        CreatedAt DATETIME2(0)      NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT SYSUTCDATETIME(),
        ExpiresAt DATETIME2(0)      NOT NULL,
        CONSTRAINT UQ_Sessions_TokenHash UNIQUE (TokenHash),
        CONSTRAINT FK_Sessions_Users FOREIGN KEY (UserId)
            REFERENCES dbo.Users (UserId) ON DELETE CASCADE
    );
    CREATE INDEX IX_Sessions_UserId ON dbo.Sessions (UserId);
END
GO

/* ---------- Cities ---------- */
IF OBJECT_ID(N'dbo.Cities', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Cities (
        CityId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Cities PRIMARY KEY,
        Name      NVARCHAR(150)     NOT NULL,
        Country   NVARCHAR(2)       NULL,      -- код страны ISO 3166 (RU, KZ, ...)
        State     NVARCHAR(150)     NULL,
        Latitude  DECIMAL(8,4)      NOT NULL,
        Longitude DECIMAL(8,4)      NOT NULL,
        CreatedAt DATETIME2(0)      NOT NULL CONSTRAINT DF_Cities_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_Cities_Coords UNIQUE (Latitude, Longitude),
        CONSTRAINT CK_Cities_Latitude  CHECK (Latitude  BETWEEN -90  AND 90),
        CONSTRAINT CK_Cities_Longitude CHECK (Longitude BETWEEN -180 AND 180)
    );
END
GO

/* ---------- FavoriteCities (N:M) ---------- */
IF OBJECT_ID(N'dbo.FavoriteCities', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FavoriteCities (
        UserId  INT          NOT NULL,
        CityId  INT          NOT NULL,
        AddedAt DATETIME2(0) NOT NULL CONSTRAINT DF_FavoriteCities_AddedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_FavoriteCities PRIMARY KEY (UserId, CityId),
        CONSTRAINT FK_FavoriteCities_Users FOREIGN KEY (UserId)
            REFERENCES dbo.Users (UserId) ON DELETE CASCADE,
        CONSTRAINT FK_FavoriteCities_Cities FOREIGN KEY (CityId)
            REFERENCES dbo.Cities (CityId) ON DELETE CASCADE
    );
END
GO

/* ---------- SearchHistory ---------- */
IF OBJECT_ID(N'dbo.SearchHistory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SearchHistory (
        SearchId   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SearchHistory PRIMARY KEY,
        UserId     INT                  NOT NULL,
        CityId     INT                  NOT NULL,
        SearchedAt DATETIME2(0)         NOT NULL CONSTRAINT DF_SearchHistory_SearchedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_SearchHistory_Users FOREIGN KEY (UserId)
            REFERENCES dbo.Users (UserId) ON DELETE CASCADE,
        CONSTRAINT FK_SearchHistory_Cities FOREIGN KEY (CityId)
            REFERENCES dbo.Cities (CityId) ON DELETE CASCADE
    );
    CREATE INDEX IX_SearchHistory_User_Date ON dbo.SearchHistory (UserId, SearchedAt DESC);
END
GO

/* ---------- WeatherSnapshots ---------- */
IF OBJECT_ID(N'dbo.WeatherSnapshots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.WeatherSnapshots (
        SnapshotId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WeatherSnapshots PRIMARY KEY,
        CityId      INT                  NOT NULL,
        ObservedAt  DATETIME2(0)         NOT NULL CONSTRAINT DF_WeatherSnapshots_ObservedAt DEFAULT SYSUTCDATETIME(),
        TempC       DECIMAL(5,2)         NOT NULL,
        FeelsLikeC  DECIMAL(5,2)         NULL,
        Humidity    TINYINT              NULL,
        PressureHPa SMALLINT             NULL,
        WindSpeedMs DECIMAL(5,2)         NULL,
        Description NVARCHAR(100)        NULL,
        Icon        NVARCHAR(10)         NULL,
        CONSTRAINT FK_WeatherSnapshots_Cities FOREIGN KEY (CityId)
            REFERENCES dbo.Cities (CityId) ON DELETE CASCADE,
        CONSTRAINT CK_WeatherSnapshots_Humidity CHECK (Humidity BETWEEN 0 AND 100)
    );
    CREATE INDEX IX_WeatherSnapshots_City_Date ON dbo.WeatherSnapshots (CityId, ObservedAt DESC);
END
GO

/* ---------- Представление: последний замер погоды по каждому городу ---------- */
CREATE OR ALTER VIEW dbo.vw_CityLatestWeather
AS
SELECT c.CityId, c.Name, c.Country, s.ObservedAt, s.TempC, s.Humidity, s.Description
FROM dbo.Cities AS c
CROSS APPLY (
    SELECT TOP (1) ws.ObservedAt, ws.TempC, ws.Humidity, ws.Description
    FROM dbo.WeatherSnapshots AS ws
    WHERE ws.CityId = c.CityId
    ORDER BY ws.ObservedAt DESC
) AS s;
GO
