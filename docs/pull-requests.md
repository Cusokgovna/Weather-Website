# Работа с Pull Requests (задание из практики 64–66)

**Pull Request (PR)** — запрос на слияние изменений из одной ветки в другую (например, из рабочей ветки в основную `main`; в старом репозитории Weather-Website основная ветка — `weather`). Это аналог Merge Request в GitLab. В PR можно обсуждать код, оставлять комментарии к строкам, и в нём автоматически запускаются проверки GitHub Actions — нельзя случайно влить код, который ломает тесты.

## Порядок работы

1. Обновить основную ветку и создать от неё рабочую:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/seo
   ```
2. Внести изменения и закоммитить (лучше несколько небольших коммитов с понятными сообщениями):
   ```bash
   git add public/robots.txt server/app.js
   git commit -m "seo: robots.txt и sitemap.xml"
   ```
3. Отправить ветку на GitHub:
   ```bash
   git push -u origin feature/seo
   ```
4. Создать PR одним из способов:
   - **Сайт GitHub:** после push вверху репозитория появится жёлтая плашка **Compare & pull request** → проверить, что *base* = основная ветка, *compare* = ваша ветка → заполнить заголовок и описание → **Create pull request**.
   - **GitHub CLI:**
     ```bash
     gh pr create --base main --head feature/seo --title "SEO: метатеги, robots.txt, sitemap" --body "Что сделано: ..."
     ```
5. Во вкладке PR **Checks** (и внизу на вкладке Conversation) видно, как проходят job'ы `test` и `db-test` из `.github/workflows/build.yml`. Если что-то упало — нажать **Details**, найти шаг с ошибкой, исправить, сделать новый коммит и `git push` — PR обновится сам и проверки перезапустятся.
6. Ревью: вкладка **Files changed** → навести на строку → **+** → оставить комментарий; **Review changes** → *Comment / Approve / Request changes*.
7. Слияние: кнопка **Merge pull request** (или **Squash and merge**) → **Confirm merge** → **Delete branch**. После слияния в основную ветку workflow запустит job `build`, и в разделе **Packages** появится новый Docker-образ.
8. Локально переключиться обратно и обновиться:
   ```bash
   git checkout main
   git pull origin main
   git branch -d feature/seo
   ```

Полезные команды `gh`: `gh pr list` — список PR, `gh pr view 1 --web` — открыть PR в браузере, `gh pr checks 1` — статус проверок, `gh pr merge 1 --squash --delete-branch` — слить.

## Что сфотографировать для отчёта

- страницу создания PR (base/compare, заголовок, описание);
- вкладку **Checks** с зелёными `test` и `db-test`;
- вкладку **Files changed** с комментарием к строке;
- PR после слияния (статус **Merged**) и новую версию образа в **Packages**.
