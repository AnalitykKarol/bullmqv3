Fastify BullMQ Webhook Service
System obsługi webhook-ów z priorytetami i integracją z n8n.

Funkcjonalności
✅ Dwa endpointy webhook z różnymi priorytetami
✅ Synchroniczne przetwarzanie i zwracanie odpowiedzi
✅ Integracja z n8n scenariuszami
✅ Dashboard BullMQ do monitorowania
✅ Obsługa błędów i retry logic
✅ Deployment na Railway
Endpointy
High Priority Webhook
POST /webhook/high-priority
Low Priority Webhook
POST /webhook/low-priority
Admin Dashboard
GET /admin
Health Check
GET /health
Zmienne środowiskowe
Ustaw następujące zmienne w Railway:

env
REDISHOST=your-redis-host
REDISPORT=6379
REDISUSER=your-redis-user
REDISPASSWORD=your-redis-password
PORT=3000
RAILWAY_STATIC_URL=your-app-url
N8N_WEBHOOK_URL=https://primary-production-f08e.up.railway.app/webhook/e6b2e3ac-1548-4583-8e75-dc40b3875505
Deployment na Railway
Połącz z GitHub:
bash
git add .
git commit -m "Updated webhook service"
git push origin main
W Railway Dashboard:
Ustaw wszystkie zmienne środowiskowe
Deploy automatycznie się uruchomi
Sprawdź działanie:
bash
curl -X POST https://your-app.railway.app/webhook/high-priority \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
Jak to działa
Flow przetwarzania:
Webhook wpada na /webhook/high-priority lub /webhook/low-priority
JSON trafia do kolejki BullMQ z odpowiednim priorytetem:
High priority: priority: 10
Low priority: priority: 1
Worker pobiera job (high priority pierwszy) i wysyła do n8n
N8N przetwarza dane i zwraca odpowiedź
Odpowiedź wraca synchronicznie do oryginalnej strony
Priorytety:
High Priority (priority: 10): Obsługiwane natychmiast
Low Priority (priority: 1): Obsługiwane po high priority
Error Handling:
Błędy n8n: Przekazywane z oryginalnym status code
Timeout: 30 sekund timeout na odpowiedź z n8n
Retry: Do 3 prób z exponential backoff
Monitoring: Wszystkie błędy logowane w dashboard
Przykład użycia
Wysłanie high priority webhook:
bash
curl -X POST https://your-app.railway.app/webhook/high-priority \
  -H "Content-Type: application/json" \
  -d '{
    "submit_id": 4,
    "category_data": [{
      "category_name": "Portfele",
      "category_link": "",
      "products_first_page": "Betlewski, portfel damski...",
      "length_requirement": 150,
      "main_keywords": "portfel betlewski-1"
    }]
  }'
Response:
json
{
  "status": "success",
  "processed_data": "...odpowiedź z n8n..."
}
Monitoring
Dashboard BullMQ dostępny pod: https://your-app.railway.app/admin

Możliwości monitoringu:

Status jobów w czasie rzeczywistym
Błędy i retry
Statystyki performance
Queue metrics
Troubleshooting
Problem z Redis connection:
bash
# Sprawdź zmienne środowiskowe
echo $REDISHOST $REDISPORT $REDISUSER
Problem z n8n endpoint:
bash
# Test bezpośredni
curl -X POST $N8N_WEBHOOK_URL -H "Content-Type: application/json" -d '{"test": true}'
Logi na Railway:
Otwórz projekt w Railway Dashboard
Przejdź do Deployment → View Logs
