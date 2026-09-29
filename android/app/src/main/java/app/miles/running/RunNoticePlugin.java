package app.miles.running;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Asks, once, to show the "Run in progress" notification. Android 13 and up
 * hide a foreground service's notification until the app may post one, and
 * that notification is how a runner sees their route is still recording with
 * the screen off. Asked when the first run starts, not when the app opens.
 */
@CapacitorPlugin(
    name = "RunNotice",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class RunNoticePlugin extends Plugin {

    @PluginMethod
    public void request(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolve(call, true);
            return;
        }
        requestPermissionForAlias("notifications", call, "answered");
    }

    @PermissionCallback
    private void answered(PluginCall call) {
        resolve(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    private void resolve(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }
}
