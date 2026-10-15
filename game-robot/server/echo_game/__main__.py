import uvicorn
import logging
from .config import Settings
from .main import create_app

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
settings = Settings()
uvicorn.run(create_app(settings), host=settings.host, port=settings.port,
            ws_max_size=8192, ws_max_queue=16, log_level="info")
