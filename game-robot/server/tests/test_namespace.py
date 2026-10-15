"""Exercise the actual firmware Settings implementation against a fake NVS."""
import subprocess
import tempfile
import unittest
from pathlib import Path

FIRMWARE = Path(__file__).resolve().parents[2] / "firmware"


class NamespaceTests(unittest.TestCase):
    def test_game_settings_never_write_original_namespaces(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "sdkconfig.h").write_text("#pragma once\n")
            (folder / "esp_log.h").write_text("""#pragma once
#include <cassert>
#define ESP_LOGW(...) ((void)0)
#define ESP_ERROR_CHECK(value) assert((value)==0)
""")
            (folder / "nvs_flash.h").write_text("""#pragma once
#include <cstdint>
#include <cstddef>
using nvs_handle_t = unsigned;
constexpr int ESP_OK=0, ESP_ERR_NVS_NOT_FOUND=1, NVS_READWRITE=1, NVS_READONLY=0;
int nvs_open(const char*,int,nvs_handle_t*);
int nvs_commit(nvs_handle_t); void nvs_close(nvs_handle_t);
int nvs_get_str(nvs_handle_t,const char*,char*,size_t*);
int nvs_set_str(nvs_handle_t,const char*,const char*);
int nvs_get_i32(nvs_handle_t,const char*,int32_t*);
int nvs_set_i32(nvs_handle_t,const char*,int32_t);
int nvs_get_u8(nvs_handle_t,const char*,uint8_t*);
int nvs_set_u8(nvs_handle_t,const char*,uint8_t);
int nvs_erase_key(nvs_handle_t,const char*); int nvs_erase_all(nvs_handle_t);
""")
            (folder / "test.cc").write_text("""
#include "settings.h"
#include <cassert>
#include <cstring>
#include <map>
#include <string>
std::map<nvs_handle_t,std::string> names;
std::map<std::string,std::map<std::string,std::string>> data;
int nvs_open(const char* name,int,nvs_handle_t* out){*out=names.size()+1;names[*out]=name;return 0;}
int nvs_commit(nvs_handle_t){return 0;} void nvs_close(nvs_handle_t){}
int nvs_get_str(nvs_handle_t h,const char* key,char* value,size_t* size){
  if(!data[names[h]].count(key))return 1;
  auto text=data[names[h]][key];
  if(value)std::memcpy(value,text.c_str(),text.size()+1);
  *size=text.size()+1;return 0;
}
int nvs_set_str(nvs_handle_t h,const char* k,const char* v){data[names[h]][k]=v;return 0;}
int nvs_get_i32(nvs_handle_t,const char*,int32_t*){return 1;}
int nvs_set_i32(nvs_handle_t,const char*,int32_t){return 0;}
int nvs_get_u8(nvs_handle_t,const char*,uint8_t*){return 1;}
int nvs_set_u8(nvs_handle_t,const char*,uint8_t){return 0;}
int nvs_erase_key(nvs_handle_t,const char*){return 0;} int nvs_erase_all(nvs_handle_t){return 0;}
int main(){
 const std::map<std::string,std::string> mappings={{"websocket","echo_ws"},{"mqtt","echo_mqtt"},
 {"audio","echo_audio"},{"display","echo_display"},{"board","echo_board"},{"assets","echo_assets"}};
 for(const auto& pair:mappings){
   data[pair.first]["original"]="preserved";
   Settings settings(pair.first,true);
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
   assert(settings.GetString("original").empty());
   settings.SetString("original","game");
   assert(data[pair.first]["original"]=="preserved");
   assert(data[pair.second]["original"]=="game");
#else
   assert(settings.GetString("original")=="preserved");
#endif
 }
 data["wifi"]["ssid"]="same-network";
 Settings wifi("wifi");assert(wifi.GetString("ssid")=="same-network");
}
""")
            for defines in ([], ["-DCONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1=1"]):
                subprocess.run(["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", *defines,
                    "-I", str(folder), "-I", str(FIRMWARE / "main"),
                    str(FIRMWARE / "main/settings.cc"), str(folder / "test.cc"),
                    "-o", str(folder / "test")], check=True, capture_output=True)
                subprocess.run([str(folder / "test")], check=True, capture_output=True)
