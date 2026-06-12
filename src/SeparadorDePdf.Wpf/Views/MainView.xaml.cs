using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Animation;

namespace SeparadorDePdf.Wpf.Views;

public partial class MainView : Window
{
    private double _lastProgressValue;

    public MainView()
    {
        InitializeComponent();
        _lastProgressValue = 0;
        ProgressBarControl.ValueChanged += OnProgressValueChanged;
    }

    private void OnProgressValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        var targetValue = e.NewValue;
        var currentValue = _lastProgressValue;

        if (Math.Abs(targetValue - currentValue) < 0.3)
        {
            ProgressBarControl.Value = targetValue;
            _lastProgressValue = targetValue;
            return;
        }

        var anim = new DoubleAnimation
        {
            From = currentValue,
            To = targetValue,
            Duration = new Duration(TimeSpan.FromMilliseconds(400)),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
        };

        _lastProgressValue = targetValue;
        ProgressBarControl.BeginAnimation(ProgressBar.ValueProperty, anim);
    }
}
