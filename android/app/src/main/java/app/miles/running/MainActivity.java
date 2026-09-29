package app.miles.running;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RunNoticePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
