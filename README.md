# Web editorial

Base inicial de la web editorial. El proyecto está preparado para Netlify, con funciones de servidor y Netlify Database. La automatización permanece pausada por defecto.

## Decisiones ya aplicadas

- Cuatro ciclos al día en horario `Europe/Madrid`: 23:00, 05:00, 11:00 y 17:00.
- Tres piezas de actualidad y tres curiosidades por ciclo, cuando superen los controles.
- La web consulta artículos publicados; los borradores y fuentes permanecen en el servidor.
- La portada rota tres curiosidades destacadas al completar cada ciclo; reutiliza piezas del archivo si hay menos de tres nuevas.
- Las páginas de artículo se renderizan desde el servidor para que cada titular tenga URL, metadatos y contenido indexable.
- Las claves y secretos se configuran en Netlify, nunca en el repositorio ni en el navegador.
- La portada prioriza móvil y mantiene la distribución de portal acordada.

## Nota sobre el horario

Netlify dispara una comprobación horaria en UTC. Esa comprobación compara la hora local con `Europe/Madrid` y solo lanza el trabajo en las cuatro horas acordadas. No busca temas en los demás disparos. Así se conserva el horario local al cambiar entre invierno y verano.

## Configuración pendiente

1. Conectar este proyecto al repositorio GitHub indicado por el propietario.
2. Crear Netlify Database (la plataforma aplica las migraciones del repositorio durante el deploy; para verificar en local: `npm run db:migrate`).
3. Añadir `OPENAI_API_KEY`, `CRON_SECRET` y `NETLIFY_SITE_URL` como variables privadas de Netlify.
4. Configurar el límite mensual de API en 20 USD. El backend registra una estimación mensual de tokens y búsquedas, y pausa generación al alcanzar el límite.
5. Revisar el flujo editorial y probar manualmente antes de activar automatización. Netlify scheduled functions usan UTC y tienen límite de 30 segundos; el proceso va en una background function con límite de 15 minutos.
6. Añadir AdSense, CMP y analítica después de preparar las páginas y controles de privacidad requeridos.

Para habilitar los ciclos programados, añadir `EDITORIAL_AUTOMATION_ENABLED=true` a las variables privadas de Netlify una vez terminada la vista previa, y confirmar que el límite mensual de facturación del proyecto API admite esos 20 USD. El valor predeterminado es apagado.

## Alcance pendiente antes de publicar a lectores

- Consentimiento de cookies y la integración real de AdSense todavía no están conectados. La medición básica de vistas/tiempo y navegación está implementada, aún necesita validarse en un despliegue de prueba.
- El registro/versionado de instrucciones existe en el esquema, pero el autoajuste con evaluación y reversión no está implementado. No permitir que el modelo edite sus propias reglas sin esos controles.
- La estimación del tope mensual usa tarifas de modelo fijadas en código; revisar las tarifas actuales de OpenAI y margen frente al panel de facturación. El límite de 20 USD de aplicación no cambia el tope duro configurado en el proyecto API.
- Las páginas legales son plantillas y deben completarse con los datos reales del titular antes de solicitar AdSense.
- Confirmar la configuración de Netlify Database en el proyecto real.
- La búsqueda de imágenes usa metadatos de Wikimedia Commons; revisar atribuciones/licencias antes de la publicación automatizada.

## Seguridad

No pongas claves reales en `.env.example`, archivos del sitio público, GitHub ni mensajes. Si una clave se expone, revócala y genera otra.
